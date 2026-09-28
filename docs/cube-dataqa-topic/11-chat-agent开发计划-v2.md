# 11 Chat Agent 开发计划 v2（后台 = 独立 claude 全代理：桥 + claude 会话 + cube-ask skill）

> 状态：**已实施（D0-D3 完毕，2026-09-24）**——实测记录见 §6.1/§10.7，验收清单见 §9.3；
> D3 预置上下文注入：2026-09-24 拍板并实施（见 §10）；
> 取代 v1 的 GLM 语义解析设计，v1 文档保留作历史（见文首标注）
> 修订：三层日志与 qa-log 位置见 [14-日志规格.md](14-日志规格.md)——qa-log 迁移至
> `logs/qa-log.jsonl`（§9.2"继续追加"条目被取代），推理层 `logs/agent/<sessionId>/`
> 前序：[11-chat-agent开发计划.md](11-chat-agent开发计划.md)（v1：C0-C3 已完成，GLM 程序形态）
> 定位：**Cube AI Agent（本地版 v2）= 独立 claude 会话（对话 + skill 问数契约，主链四步+条件步）+ Cube 语义层（执行）；
> chat_server 瘦身为 HTTP ⇄ claude 桥**

---

## 1. 背景与动机（v1 → v2 的转变）

v1（C0-C3 已完成）：chat_server 五步管线 + GLM 语义解析（prompt.py 把 skill 契约重编码进
SYSTEM_PROMPT）。实测暴露两个结构性问题（v1 文档 12/13 节讨论）：

1. **契约→prompt 重编码漂移**：skill 第2步c"view 看不到 → 改用 cube 层成员直接查"等方法论
   在重编码时丢失，outbound_view 的 ai_context 又主动误导（"消费方统一从这里查"）——
   LLM 被困在 view，跨树混查带分组维度报 Cube 400 join path（现象3）
2. **GLM 空输出偶发**：思考 token 计入 max_tokens，复合长问题重试后仍空（现象1）

v2 决策（用户拍板）：**抛弃 prompt 相关设计——对话窗口的后台就是一个独立的 claude**，
claude 通过 cube-ask skill 与 Cube 语义层互通（skill 原文就是方法论，零重编码漂移）；
chat_server 保留的部分收编为一个薄桥。

三个执行者对照（v1 文档 §7.6 的收口在此落成）：

| 形态 | 执行者 | 状态 |
|---|---|---|
| skill CLI | 人驱动 claude | 已验证（C3 对数基线） |
| v1 chat | GLM 程序形态（prompt.py 重编码 skill） | **本计划下线（第 9 节删除）** |
| v2 chat | claude 会话形态（skill 原生五步） | 本计划 |

## 2. Demo 边界（v2）

| 项 | v2 | 说明 |
|---|---|---|
| 用户/会话 | 单用户、单在线 session（沿用 v1 边界） | sessionId 固定 `default`；桥内存映射 `chat session ↔ claude session_id` |
| 响应形态 | 同步 JSON 三态（沿用 v1 契约） | answer / ask / nomatch |
| 延迟 | 60-180s/问（**接受**） | claude 五步全工具轮（读模型/meta/query/可能对数）的验证代价 |
| 数字纪律 | skill 第5步三条铁律（CLI 同款信任级别） | v1 的后端程序化强制随五步管线一起抛弃（用户明确接受） |
| 鉴权 | 无（dev 边界沿用） | host claude 已登录，`-p` 用同一 auth |

## 3. 总体架构

> 逐跳消息形态与三种通信形态（HTTP / subprocess stdin/stdout / docker exec）的详细说明，
> 见 [13-前端到claude到cube消息传递路径.md](13-前端到claude到cube消息传递路径.md)

```
┌─ 聊天窗口（Playground #/build 右侧，ext-chat.js —— 不动）────────┐
│  用户自然语言 ⇄ 对话 UI：查询计划表、结果表、口径声明、歧义选项按钮  │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼ HTTP 契约（POST /chat，CORS 沿用）
┌─ 桥（chat_server.py 瘦身 ~200 行，host 跑）───────────────────────┐
│  · HTTP/CORS/会话锁（v1 壳保留）                                   │
│  · sessionId ↔ claude session_id 映射（首次存，续轮 --resume）          │
│  · claude -p 子进程 spawn + stream-json --verbose 解析              │
│  · ask/nomatch/error 补审计（answered:false，v1 12 节逻辑收编）      │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼ 首轮：CLAUDE_INSTRUCTION + 问题；续轮：仅用户回复
┌─ 独立 claude 会话（后台，cube-ask skill 原生契约）──────────────────┐
│  读模型文件(ai_context) → 组装 → docker exec cube.js query        │
│  → 答案纪律（只基于 data 计算）+ qa-log 追加                      │
│  （meta 核验=报错才进的重入 gate；对数=高风险才做，在答案之前）        │
│  → 最终只输出三态 JSON（answer/ask/nomatch）                        │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼ docker exec cube → /v1/load、/v1/meta
                 Cube 语义层 ──▶ Oracle
```

## 4. HTTP 契约（沿用 v1，不变）

```
POST /chat
请求：{ "question": "...", "sessionId": "default" }
响应（三态，桥透传 claude 的输出）：
  A. 正常答案：
     { "type": "answer",
       "plan":  [["不同单位","suspicious.agen_name","ai_context"], ...],
       "query": {measures/dimensions/filters/timeDimensions/limit},
       "data":  [...],
       "answer": "结果表+汇总+口径声明",
       "assumption": "...", "truncated": false, "rows": 8,
       "hitPreAgg": "..."(可空) }
  B. 歧义反问：
     { "type": "ask", "question": "...", "options": ["...", "..."] }
  C. 查不了：
     { "type": "nomatch", "question": "...", "gaps": ["..."] }
```

- claude 的 skill 第1步查询计划表、第3步 query JSON 与 v1 契约字段一一对应——**前端零改动**，
  "在构建器中打开"（fiber → updateQuery）继续工作
- 桥对非 answer 响应补一条 `answered:false` 审计（v1 12 节的日志缺口修复不丢）

## 5. 组件设计

### 5.1 桥（chat_server.py 瘦身，~200 行，host 跑）

| 职责 | 说明 |
|---|---|
| HTTP/CORS/会话锁 | v1 壳原样保留（ThreadingHTTPServer，POST /chat，`Access-Control-Allow-Origin: *`） |
| 会话映射 | 首次 `claude -p` 返回的 `session_id` 存为 `chat sessionId → claude session_id`；续轮 `--resume`；resume 失败自动重建新会话 |
| claude spawn | `claude -p "<首轮:指令+问题 / 续轮:用户回复>" --resume <claude_sid> --output-format stream-json --verbose`；逐行收事件流，取最后一条 `result` 行解析三态 JSON |
| 补审计 | answer 由 claude 按 skill 写 qa-log；ask/nomatch/error 由桥写 `{outcome, answered:false}`（v1 `_qa_log_outcome` 逻辑收编） |
| CLAUDE_INSTRUCTION | 内嵌常量（~15 行，见 5.2），不单独建文件 |

- 端口 4100（不变，面板指向不动）；compose chat 服务删除后由 host 桥占用
- claude CLI 只在宿主机——桥 host 跑（不进容器）
- spawn 注入 `CLAUDE_CODE_GIT_BASH_PATH`（`_git_bash()` 校验 basename=bash.exe 后覆盖）——
  agent 的所有 shell 命令都经 Bash 工具执行（零 PowerShell）；系统级变量指到 git-bash.exe
  GUI 启动器（非 shell 本体），不覆盖 claude 会回退 PowerShell 工具、绕开 bash 通道
- **通信形态：subprocess 进程调用（非网络 API）**——v1 那种直连 LLM API 的方式不再存在，
  claude CLI 自己管理 API 调用；桥只管 spawn + stdout 解析
- `claude -p --output-format stream-json --verbose` 逐行输出事件流（init/assistant/tool_use…），
  最后一行 `{"type":"result","result":"<最终文本>","session_id":"<uuid>",...}`——
  `result` 是三态 JSON 候选文本，`session_id` 是续轮句柄；`-p` 为 headless 模式（无交互 UI）

### 5.2 CLAUDE_INSTRUCTION（桥给 claude 的首轮指令，要点）

> 2026-09-24 设计要点存档；现行以 chat_server.py 为准——tables 平等契约、
> audited 字段与契约重排见 10.2 修订注。

```
用 cube-ask skill 处理下面的用户问题，完整执行五步契约。
约束：
1. 歧义时不要用 AskUserQuestion（本环境无交互 UI）——输出
   {"type":"ask","question":"...","options":["...","..."]}
2. 确实查不了时输出 {"type":"nomatch","question":"...","gaps":["..."]}
3. 回答时输出 {"type":"answer","plan":[["自然语言","cube.member","依据"],...],
   "query":{...},"data":[...],"answer":"结果表+口径声明+数据范围","assumption":"...",
   "truncated":bool,"rows":n,"hitPreAgg":"..."}
4. 无论任何情况，最终只输出一个上述三态 JSON 对象（不要 markdown 围栏、不要解释文字）
5. 追加 qa-log 时在 JSON 里加 "source":"ui" 字段
用户问题：{question}
```

- skill 触发：cwd = 项目目录（项目 skill 自动加载）+ 指令点名 cube-ask 双保险
- 续轮（--resume）只发用户回复——约束在 claude 上下文里天然持续；漂移时回复末尾附短提醒
- AskUserQuestion 在 `-p` 下不可用（无交互终端可答）；**ask JSON 是它的前端可渲染等价物**——
  同样是"问题+选项"，一个走终端 UI，一个走 HTTP JSON + ext-chat.js 选项按钮；
  skill 原文写了 AskUserQuestion，指令强约束覆盖（第 8 节风险）

### 5.3 前端（不动）

`playground-ext/ext-chat.js` / `index.html` / `sync-index.sh` 全保留——消息渲染、三态处理、
选项按钮、"在构建器中打开"、自愈逻辑全部复用。

## 6. 开发阶段（D0-D2）

| 阶段 | 内容 | 交付物 |
|---|---|---|
| **D0 桥改造** | chat_server.py 删五步管线（_pipeline/_missing_members/_assembled_query/_qa_log 主链路），保留 HTTP/CORS/会话锁 + 补审计；新增 claude spawn/会话映射/resume/三态解析 | `curl -X POST localhost:4100/chat -d '{"question":"..."}'` 三态响应走 claude |
| **D1 桥指令与三态实测** | CLAUDE_INSTRUCTION 定稿（skill 点名 + 三态 JSON 约束 + AskUserQuestion 禁用 + qa-log source:ui）；answer/ask/nomatch 三条路径各实测 | 三态响应正确；claude 五步后 JSON 遵从度验证通过 |
| **D2 验证闭环 + v1 下线** | 面板问答全链路回归（领票复合问→反问→回复→出数、金额对数、nomatch）+ qa-log 审计 + 延迟记录；执行第 9 节删除清单 + compose chat 服务移除 | 验收清单（第 9.3 节）全绿；v1 文件清理完成 |

### 6.1 D0/D1 实测记录（2026-09-24，host 桥 4100 + bypassPermissions）

| 实测项 | 结果 |
|---|---|
| answer 路径 ×3 | 19156 张（与词典 2026-09-22 实测一致）/ 149 组跨单位×票种 / 271 组 KPI——真数据、plan/query 结构完整、`source:"ui"`、skill 五步全走（读模型→meta→组装→docker exec cube.js query→qa-log） |
| nomatch 路径 | "监管规则"→4 条精确缺口（meta 核验 21 成员无"规则"、原料表无字段、整改通知表故意不建、恢复路径指 cube-modeling），43s；桥补 `answered:false` 审计 ✓ |
| 续轮 --resume | t2 会话追问"只看省医疗的"——上轮 149 组上下文保持，正确加 bill_name contains '医疗' 过滤出 35 组/14209 张（同单位数字 10021/2272 与上轮对上），3m58s |
| qa-log 双写 | claude 写 answer 主链路（skill 模板 + `source:"ui"`）+ 桥补 nomatch/error（`answered:false`）——两路实测落盘 ✓ |
| JSON 遵从度 | D0 实测 6 问全部一次合法三态 JSON；D2 金额问首输出断裂（char 2076），**桥 --resume 重试一次成功恢复**——重试路径实战验证 |
| ask 三态 | 数据问未触发（6 问 0 ask，词典+ai_context 覆盖全，直接作答+assumption 声明）；**面板"你好"自然触发**：claude 25s 返回 ask JSON（问候+4 引导选项），面板选项按钮渲染正常——ask 管道实战验证 |
| 延迟 | 43s-144s/问（答疑），金额 161s（含重试），续轮 239s（含重读模型），问候 25s；CLAUDE_TIMEOUT 300→600（模糊问五步完成后差 18s 被杀过） |
| 权限 | 工具名 allowlist 在 -p 下只放行只读工具 → bypassPermissions 才通（第 7 节 6）；Windows 下杀 cmd 包装会孤儿化 claude.exe，超时后需 taskkill 清理 |
| D2 v1 下线 | 9.1 删除清单执行（5 文件+__pycache__）；compose chat 服务段删除、cube-chat 容器已删、compose config 校验过；前端资源验证：playground 200、index.html 含 ext-chat 标签、/ext-chat.js 200（绝对路径引用，非 /playground/ 前缀） |
| data 契约漂移修复（10:41 双口径答案） | claude 把 data 重组为 `[{scope,rows:[...]}]` 嵌套 → 前端 renderTable 按首行键渲染，嵌套数组 String() 成 `[object Object]`。修复：CLAUDE_INSTRUCTION 收紧（data 必须扁平行数组，多口径其余口径只进 answer 文本）+ 桥 `_normalize` 展平兜底（stderr 留痕）；同问重跑验证：5 行扁平、成员名键、嵌套 0 |

> **2026-09-27 修订（tables 平等契约，17 号文档）**：上表「data 契约漂移修复」引出的
> "多口径 data 取主口径、其余口径只进 answer 文本"约束**废除**——次口径概念整体废除：
> 答案需要几个口径就返回几张表（`tables:[{title,query,rows,total}]`，结构完全对称），
> `data` 字段删除（前端是唯一消费方；`_normalize` 展平兜底防漂移），`answer` 瘦身为
> 纯口径声明/拍板结论/数据范围（表格数据不再进文本）。§5.2 的约束 3 契约模板同步被
> 17 号取代。09-24 记录保留为史实——当时的修复正确解决了嵌套渲染问题，但"塞进文本"
> 的处置埋下了 09-27 事故：次口径进了前端不读的字段（16 号 §2.2）。

## 7. 关键设计点

1. **claude 输出 = 三态 JSON**（2026-09-28 起契约加可选 audited 字段——高风险对数
   通过时 true，前端 foot 徽标）：skill 第1步计划表/第2步 query/第3步 data 与契约字段
   一一对应——claude 跑完契约把结果按三态 JSON 收口
2. **会话 = 按问拉起 + `--resume`**：首次存映射，续轮带完整上下文——反问确认闭环天然持久，
   比 v1 的 pending 历史 hack 干净（该机制随五步管线抛弃）
3. **skill 原生方法论**：读模型文件、meta 核验（2026-09-28 起重入 gate）、组装规则、
   对数纪律全是 SKILL.md 原文——
   v1 现象3 的"view→cube 回退"缺失在 v2 结构性消失
4. **AskUserQuestion 禁用**：`-p` 无交互 UI；桥指令强约束"歧义只输出 ask JSON"
5. **qa-log 双写**：claude 按 skill 写主链路（桥指令要求 `source:"ui"`）+ 桥补 ask/nomatch/error
   的 `answered:false` 审计——v1 12 节的日志修复不丢

   > **2026-09-28 R3 修订（14 号 §4.1）**：双写**收敛为桥单写**——agent 按 skill 模板手写
   > echo 追加实测 ~28.4s/问（约占单问 45%）且两套写实现必漂移（claude 侧 time UTC 占位
   > 即实例），answer 行改由桥 `_qa_log_answer` 从最终三态 JSON 机械派生，skill/agent 零
   > 写日志指令；日志结构（字段/行形）不变。本条保留作沿革。
6. **权限通道 = bypassPermissions（D0 实测定案）**：工具名 allowlist（`--allowedTools
   "Bash Read ..."`）在 `-p` 下只放行 Read/Grep 等只读工具，Bash 的命令级权限仍走
   sandbox 审批——headless 无法批准 → docker exec 全拦（语义解析完整、执行通道全阻，
   实测 nomatch 收场）。可靠通道是 `--permission-mode bypassPermissions`：冒烟 docker
   exec 真正执行、`permission_denials:[]`、全程 6s。本地单用户 demo 边界（第 2 节）下
   采用；`--max-turns 40` 防失控

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 延迟 60-180s/问 | demo 边界接受（第 2 节）；面板 fetch 无超时；后续流式为 v3 方向 |
| claude 无视指令调 AskUserQuestion（-p 下调用失败） | 指令强约束 + 实测验证；claude 失败后通常自然降级为文本，桥解析失败走重试 |
| 五步后不输出合法 JSON | `--output-format stream-json --verbose` 逐行收，取最后 result 行；解析失败重试 1 次 → 明确报错不静默 |
| claude 会话上下文过长/漂移 | --resume 单线会话；resume 失败桥自动重建新会话（映射重置） |
| claude 跑偏（调不该调的工具/改模型） | 指令点名 cube-ask"只查不改"；bypassPermissions 下约束靠指令 + skill 契约（本地 demo 边界接受） |
| -p 下 Bash 命令级权限被 sandbox 拦（allowlist 不放行命令） | `--permission-mode bypassPermissions`（第 7 节 6，实测唯一通路） |
| 单点：claude CLI 只在宿主机 | 桥 host 跑（本来就是）；容器化 claude 不在本计划范围 |
| qa-log 并发写 | claude 追加 + 桥追加，JSONL 追加模式无冲突 |

## 9. v1 文件处置清单

> 项目非 git 仓库，删除不可恢复——本清单即审批记录，D2 阶段执行。

### 9.1 删除

| 文件 | 理由 |
|---|---|
| `chat/prompt.py` | GLM 语义解析模板（SYSTEM_PROMPT/USER_TMPL/_call_llm/_extract_json/semantic_parse）——claude 会话 + skill 原文替代；现象1/现象3 的根因载体 |
| `chat/context_loader.py` | ai_context 读取 + pick_candidates 候选预筛——claude 自主读模型文件（A2），无需预筛 |
| `chat/cube_client.py` | /v1/load、/v1/meta 调用——claude 通过 docker exec cube.js query 自己执行，桥不需要 |
| `chat/词典.json` | 口径词典程序版（当前/最近/可疑票据范围）——claude 读 skill 的 `references/口径词典.md`（原生） |
| `chat/test_c0.py` | C0 宿主机回归（测 prompt/context_loader/cube_client）——随模块抛弃 |
| `docker-compose.yml` 的 chat service 段 | cube-chat 容器（GLM in container）——GLM 路径下线，4100 让给 host 桥 |

### 9.2 保留改造

| 文件 | 处置 |
|---|---|
| `chat/chat_server.py` | **改造为桥**：删五步管线（_pipeline/_missing_members/_assembled_query/_qa_log 主链路/pending 历史），保留 HTTP/CORS/会话锁 + 补审计（_qa_log_outcome 收编） |
| `playground-ext/*`（ext-chat.js/index.html/sync-index.sh） | 不动 |
| `regress/qa-log.jsonl` | 审计数据，继续追加 |
| `.env` 的 `LLM_BASE_URL`/`LLM_MODEL` 条目 | GLM 下线后无消费者——用户文件列为**可选清理**，不强制 |
| `docs/cube-dataqa-topic/11-chat-agent开发计划.md`（v1） | 保留作历史，文首标注被 v2 取代 |

### 9.3 D2 验收清单（2026-09-24 执行完毕）

- [x] host 桥 4100 在跑，compose chat 服务已移除（cube-chat 容器已删，compose config 校验过），面板问答走 claude 路径（面板"你好"实测 200）
- [x] 领票复合问（回归序号 1）→ v2 下直接出数 149 组（词典+ai_context 全消歧，不问为合法）；反问闭环由 --resume 会话续轮实测（"只看省医疗的"→35 组/14209，上下文与数字衔接）+ 面板"你好"自然触发 ask（4 选项渲染）
- [x] 金额对数回归：20 票种、合计 880,769,085,981.21 元、口径声明完整（result='0' 定案，排除解除 23 条/字典外 '3' 15 条）——首输出 JSON 断裂经桥 --resume 重试一次恢复（重试路径实战验证）
- [x] nomatch 精确缺口（"监管规则"→4 条缺口）不劣化
- [x] qa-log `source: "ui"` 记录齐全（claude 主链路 + 桥 ask/nomatch/error 补审计；已知小瑕疵：claude 写的 time 字段偶为 00:00:00.000Z 占位，不影响内容）
- [x] "在构建器中打开"正常——claude 输出 query 结构完整（measures/dimensions/filters/timeDimensions/limit），前端零改动
- [x] 延迟记录：答疑 43-144s、金额 161s（含重试）、续轮 239s、问候 25s（GLM 20-50s → claude 全代理换验证代价）
- [x] 第 9.1 节删除清单执行完毕（prompt.py/context_loader.py/cube_client.py/词典.json/test_c0.py/__pycache__ + compose chat 服务段 + cube-chat 容器）

## 10. 预置上下文注入（D3，2026-09-24 拍板，待实施）

> 动机：bridge-2026-09-24.log 耗时分析——3 次真实问数均值 ~81s（57.9-99.4s），大头是
> 模型生成（thinking 每轮 5-16s + 最终长答案 10-20s，占 63-80%），工具执行仅 7-14s
> （单次最长 2.1s，DB/API 不慢）；耗时集中在"发现"轮：第0步 check、读模型 yml、
> 读 .env/docker-compose 构造查询通道、读词典，共 5-7 轮 × 每轮 thinking 5-16s

### 10.1 耗时分析实据（bridge-2026-09-24.log）

| 会话 | 问题 | 端到端 | 模型生成(thinking+答案) | 工具执行 | 轮数 |
|---|---|---|---|---|---|
| 11:59 | 可疑票据种类和数量 | 85.8s | 47.9s thinking + 20.9s 最终答案 ≈ 80% | 7.4s | 9 |
| 13:50 | 缴库单总数/金额/状态 | 99.4s | 71.1s ≈ 72% | 14.3s | 19 |
| 14:01 | 收款金额和净额 | 57.9s | 36.6s ≈ 63% | 8.2s | 11 |

另外"你好"也要 12-41s（照样全量 spawn agent）。通道发现实据：agent 主动绕开
skill 规定的 docker exec 通道（嵌套引号难写对），自己找 REST API——
烧掉读 .env、读 docker-compose、构造 Authorization header 三轮。

### 10.2 拍板记录（AskUserQuestion 四项）

| 决策点 | 拍板 |
|---|---|
| 注入深度 | 成员名 + description + ai_context，机械提取 ~10-15KB（不摘要）；meta 核验保留兜底 |
| 第2步 meta 核验 | 保留，agent 照跑（硬 gate 不省，准确性优先） |
| 口径词典 | 全文注入 6.3KB（歧义协议照旧，桥每问现读、加词条立即生效） |
| resume 链内陈旧 | 会话空闲超 N 分钟自动重建（SESSION_TTL 建议 30 分钟，env 可调） |

> **2026-09-28 修订**：上表"第2步 meta 核验：保留，agent 照跑（硬 gate 不省）"
> 已修订——meta 核验改为**失败路径的重入 gate**（执行报错才进，修正后计划须
> meta 通过才重查），query 正常返回不跑。理由：meta 能拦的四种失败（拼写幻觉/
> public:false/view 缺口/真没建模）query 报错同样暴露，前置检查在成功路径上是
> 纯税；防幻觉契约由重入 gate 保留。高风险对数同步从答案纪律拆出单独成步
> （第5步，置于答案纪律之前，不一致不得交付）；对数通过 → answer payload 加
> `audited: true`（前端 foot 徽标「已与 Oracle 对数一致」）；qa-log 结构不变
> （不记对数）。详见 SKILL.md 第4/5步与 01-cube-agent-ask.md 修订注。

### 10.3 设计

首轮 prompt = CLAUDE_INSTRUCTION（改造）+ 预置上下文 + 问题；续轮 --resume 不重注。
预置上下文由桥新增 `_preset_context()` 生成，**每问现扫**（yml 读取毫秒级），三块：

| 块 | 内容 | 来源 | 大小 |
|---|---|---|---|
| ① 模型摘要 | 每个 cube/view 的 title + 成员名 + description + ai_context，机械提取不摘要 | 每问现扫 `conf/model/views/*.yml + cubes/*/*.yml` | ~10-15KB |
| ② 通道配方 | REST 模板（`localhost:4000/cubejs-api/v1/load`，Authorization 从 .env 解析预填）+ `docker exec cube.js` 备选形态 | 每问现读 `.env` | ~1KB |
| ③ 口径词典 | 全文原样注入 | 每问现读 `references/口径词典.md` | 6.3KB |

关键原则：**桥只做机械搬运，不做 LLM 摘要**——"成员语义唯一真相是模型文件"不破，
注入内容 100% 来自 yml 原文。与 v1 `context_loader` 的区别：不筛候选、不摘要、不改写
（§9.1 删除它的理由"claude 自主读模型文件"在 D3 修正为"桥机械搬运 + meta 核验保留"）。

配套改动：
- CLAUDE_INSTRUCTION 加一条：预置上下文已注入，跳过读模型文件与词典，直接进语义解析
- SKILL.md 第0/1步同步加"桥已注入预置上下文时跳过"分支（防契约字面执行仍去 Read）
- **meta 核验**：2026-09-28 修订为失败路径重入 gate（报错才进，修正后须 meta
  通过才重查；原"每查必跑硬 gate"，见 10.2 修订注）

### 10.4 刷新机制（四层）

1. **层1（基础）**：每问现扫，零缓存——改完模型/词典下一问即生效。实现注释写明禁令：
   任何启动时缓存必须带失效机制，防止未来图省事加缓存引入陈旧
2. **层2（会话级，拍板）**：会话空闲超 N 分钟自动重建——桥记 `last_active` 时间戳，
   超时丢弃 `claude_sid`，下次请求按首轮重注最新预置上下文；重建时 bridge.log 留 WARN 痕。
   已知代价：空闲超时重建丢会话内指代（"刚才那个再按票种拆一下"失效）——缓解：拍板结论
   按契约会立即回写词典（跨会话不丢）；纯追问通常发生在几分钟内，30 分钟阈值一般碰不到，
   真碰到用户重述即可
3. **层3（会话膨胀，2026-09-24 日志补拍）**：resume 链累计轮数超上限（`SESSION_MAX_TURNS`，
   建议 20 轮）自动重建——与层2 同路径（丢 `claude_sid` 重注，WARN 留痕），防止单线
   会话每轮变慢。实据：领票入库问（14:42）183.1s——同一 `claude_sid` 从 12:03 连用到
   14:42 五个会话不换，链上累积 41 轮历史（thinking 块、最长 16K 字符 tool_result、
   7-19K 字符历史答案）每轮全量重发 → 单轮 thinking 间隔从上午 5-16s 涨到 21-46s；
   14:29 收缴资金问零次 Read（无发现开销）仍 114.7s、首轮 thinking 53.6s——慢的是
   prompt 体积不是发现。SESSION_TTL 只治跨时段陈旧（连续对话中空闲不触发），
   链轮数上限补这个盲区；重建代价远小于膨胀代价（41 轮链下单轮 thinking 慢 2-3 倍）
4. **层4（契约兜底）**：CLAUDE_INSTRUCTION 和 SKILL.md 各加一条——**"预置摘要与 meta
   核验输出冲突时，以 meta 为准"**（meta 是编译事实，摘要只是搬运）；即使层1/2/3 全失效，
   cube-modeling 新加的成员也只是"摘要里没有"，不会被误判"没建模"——meta 输出里有就照查

### 10.5 预期收益与回归验证

预期：砍掉发现轮 5-7 个 × thinking 5-16s ≈ **省 30-50s**，均值 ~81s → ~40-50s
（第 2 节延迟边界随之修订）；代价是每次 spawn 多 ~20KB prompt（远小于省下的时间）。

回归验证两项（D3c）：
1. 耗时对比——用 2026-09-24 原话重问（"不同单位当前的可疑票据种类和数量"等），对比均值
2. 刷新测试——问数 → 改 yml（加成员）/ 词典加词条 → 同会话再问（间隔 > N）→
   验证重注生效、新成员能查出数

### 10.6 D3 开发阶段

| 阶段 | 内容 | 交付物 |
|---|---|---|
| **D3a 桥预置注入** | `_preset_context()`（三块机械提取）+ CLAUDE_INSTRUCTION 改造 + 会话 `last_active`/`SESSION_TTL` 空闲重建 + 链轮数上限 `SESSION_MAX_TURNS` 重建 | 首轮 prompt 含预置上下文；问数日志不再出现读 yml/.env 轮；长链会话自动重建留痕 |
| **D3b skill 契约同步** | SKILL.md 第0/1步跳过分支 + "meta 冲突以 meta 为准"契约 | skill 契约与桥行为一致 |
| **D3c 回归验证** | 耗时对比 + 刷新测试 | §2 延迟修订；实测记录补 §10.7 |

### 10.7 D3 实测记录（2026-09-24，测试实例 4101 + 生产桥 4100 重启）

| 实测项 | 结果 |
|---|---|
| 结构目标（核心验收） | **发现轮全砍**：可疑票据问工具 8→5 次、轮数 9→6，**零 Read yml / 零读 .env / 零读 docker-compose**——5 次工具调用全为 REST 查询/对数/写日志（通道配方预填生效） |
| 刷新测试（层1+层2） | 词典追加临时词条 → 空闲 192s 后同会话再问 → `WARN 会话空闲 192s 超 60s，重建（重注预置上下文）` + spawn resume=False + **新词条直接进 plan 依据列**（「可疑明细拆分」词条被引用出数）——三层刷新机制完整工作 |
| 预置上下文实测大小 | ①模型摘要 30.4K 字符（23 cube + 10 view + 279 成员行，含布尔标注）+ ②通道 964 + ③词典 3.6K ≈ **55KB/次注入**（§10.3 估算 10-15KB 偏低，已按实测修正认知） |
| 端到端耗时 | **未改善，且低于基线**：可疑票据问 127s vs 上午 85.8s——主因是**下午 GLM API 整体变慢**（同长度 18.7K 字符最终答案生成 53.3s vs 上午 20.9s，输出速率 906→351 字符/s；14:29 会话 53.6s 首轮 thinking 同证），非 D3 引入 |
| thinking 膨胀（新发现） | 超小问（"单位数是多少"）出现 **26.9K 字符超大 thinking 块**——模型逐字引用注入的词典/成员清单做口径推敲（agen_cnt 全状态 vs result='0' 过滤的纠结数千字）。两个可能因素：API 变速（433 vs 906 字符/s）+ **全量清单注入 → 候选全推敲效应**。后续方向：裁短注入（去 cube 说明/重复 description）+ 限制最终答案长度（top-N 表）——待观察后再动 |
| writeoff_view quirk（转 cube-modeling） | `includes` 里 `- no` 未加引号，YAML 1.1 解析为布尔 False（js-yaml 同语义）——名为 `no` 的成员实际未进交付面；桥侧已机械标注（`_member_ref`），模型侧修复走 cube-modeling |
| 生产桥重启 | 旧进程（`python chat\chat_server.py`，PID 30132）taskkill /T 杀树，新进程带 D3 代码起于 4100（GET / 健康 200） |
