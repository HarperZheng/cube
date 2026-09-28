# chat_server.py介绍

chat/chat_server.py = 桥，一个约 240 行的 Python HTTP 服务（ThreadingHTTPServer），监听 4100端口。名字的由来：它自己不做任何智能工作，只负责把面板和智能体的通信“接起来”：

```
面板（Playground 聊天窗）
     ⇅ HTTP POST localhost:4100/chat {question, sessionId}
  桥 chat_server.py（宿主机 python 进程）
     ⇅ subprocess stdin/stdout
  claude -p 会话（问数契约跑完，回三态 JSON）
```

# 职责（chat_server.py 做什么）

| 职责 | 说明 | 代码位置 |
|---|---|---|
| 通信接入 | HTTP 服务 `POST /chat`（ThreadingHTTPServer）+ CORS 头 + `GET /` 健康检查（返回版本、会话表、claude CLI 是否可用） | chat_server.py:450-475 |
| 会话管理 | `sessionId → claude_sid` 内存映射；续轮 `--resume <sid>` 接上下文；resume 失败自动重建会话重试一次；会话锁（单问串行，前问未完时排队并打点，不隐身） | chat_server.py:68-69, 493-500 |
| spawn claude | 首轮发 `CLAUDE_INSTRUCTION + 问题`，续轮只发用户回复；`--output-format stream-json --verbose` + `--permission-mode bypassPermissions`（权限实测唯一可靠通道，D0）；prompt 走 stdin 免转义；超时 600s → `taskkill /T` 杀进程树（Windows 防孤儿 claude.exe） | chat_server.py:198-338 |
| 三态解析兜底 | 剥 ```json 围栏取首个完整对象；`action→type` 同名映射；data 嵌套 `{scope,rows}` 展平为扁平行数组（前端 renderTable 按首行键渲染，嵌套会渲染坏）；解析失败重试 1 次（附提醒、走 --resume 保上下文），仍失败明确报错 | chat_server.py:341-423 |
| qa-log 单写 | answer 行由 `_qa_log_answer` 从最终三态 JSON 机械派生（14 号 §4.1 R3：agent 零动作、不为日志构造内容；`_send` 前落，浏览器断连照落）；ask/nomatch/error 由 `_qa_log_outcome` 补审计（`answered:false`）——问了但没出数的问题有痕 | chat_server.py:714-766（两函数）+ 829（挂点） |
| 失败隔离 | 所有日志写入失败只留 stderr 痕，不阻塞问答 | 各 `_log`/`_oplog` 函数 |

# 三态契约（透传，前端零改动）

桥不加工 claude 的业务输出，原样透传三态 JSON：

- `{"type":"answer", plan, query, data, answer, assumption, truncated, rows, hitPreAgg}` — 有数
- `{"type":"ask", question, options}` — 歧义，前端出选项按钮
- `{"type":"nomatch", question, gaps}` — 查不了，gaps 列出缺口

# 日志（包括三层）

| 层 | 位置 | 内容 |
|---|---|---|
| 结果层 | `logs/qa-log.jsonl` | 审计主链路，**桥单写**（14 号 §4.1 R3：answer 行桥从最终 JSON 派生，agent 零动作；桥写 ask/nomatch/error） |
| 推理层 | `logs/agent/`（平铺） | `<HHMMSS>_<attempt>.jsonl` stream-json 事件流官方原样 + 同名 `.stderr.log` + `index.jsonl`（串 resume 链条，行内带 sessionId） |
| 运维层 | `logs/bridge-YYYY-MM-DD.log` | `<ISO+08:00> <LEVEL> [组件] 消息`，[bridge]/[claude]/[agent]；claude 事件逐行打点（thinking/tool_use/tool_result 全量内容块），`tail -f` 实时看五步 |

调试开关：`CLAUDE_DEBUG_LOG=1`（L3-lite）。bridge.log 打点默认开。

# 不是什么

- **不是 LLM API 客户端**——桥不直接调 GLM，claude CLI 自己管理模型调用；桥↔claude 是 subprocess stdin/stdout，非网络 API

# 如何启动

项目根目录下
````
python chat/chat_server.py
````

- 可选环境变量：CHAT_PORT（默认 4100）、CLAUDE_TIMEOUT（默认 600 秒）、CLAUDE_DEBUG_LOG（L3-lite 调试开关，默认关）
- 验证：curl http://localhost:4100/ → 返回 {"service":"cube-ai-agent","version":"v2-bridge（claude 全代理，14 号日志 R3：qa-log 桥单写）",...}
- 停止：前台跑就 Ctrl+C；后台跑就结束对应 python 进程