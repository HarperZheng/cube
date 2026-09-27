# 13 前端到 claude 到 cube 消息传递路径

> 定位：v2 架构（[11-chat-agent开发计划-v2.md](11-chat-agent开发计划-v2.md)）的通信路径说明——
> 一条链上三种不同的通信形态，逐跳消息形态与实测依据
> 前序：11-v2 §3 总体架构、§5 组件设计

---

## 1. 三种通信形态总览

一条问答链上依次经过**三种不同的通信形态**，没有任何一段是"面板直连 LLM API"：

| 段 | 形态 | 载体 |
|---|---|---|
| 面板 ⇄ 桥 | HTTP JSON | `POST localhost:4100/chat`（ext-chat.js ⇄ chat_server.py） |
| 桥 ⇄ claude | **subprocess stdin/stdout**（非网络 API） | `claude -p` 子进程，prompt 走 stdin，结果走 stdout |
| claude ⇄ cube | **docker exec 管道** | PowerShell 工具调 `docker exec cube`；容器内 cube.js 再走 HTTP `/v1/load` |

## 2. 全链路图

```
┌─ 面板 ext-chat.js（Playground #/build 右侧）──────────────────────────┐
│  用户输入"不同单位当前的可疑票据种类和数量" → 点发送                    │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼ ① HTTP POST（ext-chat.js:395）
                 POST localhost:4100/chat
                 {"question":"不同单位当前的可疑票据种类和数量","sessionId":"default"}
┌─ 桥 chat_server.py（宿主机 python 进程，占 4100）─────────────────────┐
│  · 会话锁 + 内存映射 sessionId → claude_sid（首次无 → 走首轮）          │
│  · spawn 子进程：claude -p --output-format json --permission-mode     │
│    bypassPermissions [--resume <claude_sid>]                          │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼ ② subprocess stdin/stdout（chat_server.py:62-93，非网络 API）
                 stdin：首轮 = CLAUDE_INSTRUCTION+问题；续轮 = 仅用户回复
┌─ claude 会话（宿主机进程，GLM-5.3-Flash 后端，~15-20 轮智能体循环）────┐
│  THINK（推理，不外发）→ Skill(cube-ask) → Read 模型 yml →              │
│  ③ PowerShell 工具调 docker exec（见下）→ Write tmp-query.json →      │
│  qa-log 追加 → 最终 stdout 只输出一个三态 JSON                         │
└──┬───────────────────────────────────────┬──────────────────────────┘
   ▼ ③ docker exec 管道（每次工具调用）      ▼ ④ claude → stdout
   docker exec cube sh -c \                 {"result":"{\"type\":\"answer\",
     "node /cube/agent/cube.js \             ...三态JSON文本...\"}",
      meta superv_view / query '<json>'}     "session_id":"<uuid>"}
   ┌─ cube 容器内 ─────────────────────────┐
   │ node cube.js → POST localhost:4000/   │
   │ /cubejs-api/v1/load → Cube 语义层     │
   │ → 生成 SQL → Oracle → 行数据 JSON     │
   └───────────────────────────────────────┘
               ▼ ⑤ 桥解析（剥围栏/花括号匹配三态 JSON + _normalize）
                 非 answer 落 answered:false 审计 → HTTP 200 三态 JSON
┌─ 面板 renderResponse（ext-chat.js，前端零改动）───────────────────────┐
│  answer：plan 表+query+data+口径声明 markdown；"在构建器中打开"        │
│          → ext-drill.js updateQuery 填进构建器                        │
│  ask：选项按钮；nomatch：缺口列表                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 逐跳消息形态

| 跳 | 形态 | 消息内容 |
|---|---|---|
| ① 面板→桥 | HTTP JSON | `{question, sessionId}` |
| ② 桥→claude | **subprocess**（stdin 文本 + argv 旗标） | 首轮：指令+问题；续轮：仅问题（上下文靠 `--resume` 在 claude 侧持久） |
| ③ claude→cube | **docker exec 管道** | `node /cube/agent/cube.js meta/query`；容器内再走 HTTP `/v1/load` → Cube → Oracle |
| ④ claude→桥 | **stdout JSON** | `{"result":"<三态 JSON 文本>","session_id":"<uuid>"}`——session_id 是续轮句柄，桥存映射 |
| ⑤ 桥→面板 | HTTP JSON | 三态原样透传：answer（plan/query/data/answer/assumption…）/ ask / nomatch |

## 4. 关键点

1. **桥↔claude 不是 API 调用**——是子进程的 stdin/stdout 文本交换，claude CLI 自己管理对
   GLM 端点的网络调用。桥完全看不到 claude 的中间过程（思考、工具调用），只拿到最终
   `result`；中间过程只存在于 claude 会话 transcript（见第 5 节）
2. **claude↔cube 不是直接 HTTP**——claude 用 PowerShell 工具调 `docker exec`，进容器后
   cube.js 才对容器内的 Cube 发 HTTP；Oracle 凭证在容器 env 里，claude 从不接触
3. **会话持续性**：桥内存 map 存 `sessionId → claude_sid`，续轮 `--resume`；桥重启映射
   清空（内存态），面板下一问自动开新 claude 会话；transcript 文件不受影响
4. **容器只剩 cube 一个**（v2 §9.1 删除清单执行后）：chat 服务容器已删，4100 由宿主机桥
   进程占用，claude CLI 只在宿主机（v2 §8 单点风险行）
5. **聊天窗口看不到推理**——桥只透传最终三态 JSON，这是 v2 设计（§5.1）

## 5. 推理与中间过程在哪看

claude 每次拉起的会话逐事件落盘为 transcript JSONL：

| 途径 | 位置 | 内容 |
|---|---|---|
| 可读推理抽取 | 项目 `.tmp-d0/reasoning-<sid 前 8 位>.txt` | 完整思考块+时间戳（按会话抽取） |
| 原始 transcript | `C:\Users\87239\.claude\projects\D--develop-cube\<claude_sid>.jsonl` | 每行一个事件；assistant 消息里 `"type":"thinking"` 的 content 即思考原文 |
| 交互式回放 | 终端 `claude --resume <claude_sid>` | 整个会话（思考+工具调用）可视 |
| 会话 ID 对照 | `GET localhost:4100/` | `chat sessionId → claude_sid` 映射（桥重启后内存态清空，transcript 文件仍在） |

## 6. 实测依据（2026-09-24）

- 逐轮时间线与 token 用量：transcript `8e5a4d2f…`（你好→金额统计→复合问三轮）拆解，
  见 11-v2 §6.1 实测记录；复合问 132s 中 GLM 推理 ~100s（76%）、Cube API 查询仅 ~5-8s
- 每轮 `cache_read=0`（无 prompt 缓存，54-67k 输入全量重算）——延迟主导因素
- claude 会话内执行工具名实为 `PowerShell`（claude CLI 在 Windows 的 shell 工具），
  docker exec / Write / Read 均经它发出
