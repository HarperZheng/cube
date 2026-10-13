# 27 - /agent 问数契约接口与 Analytics Chat 建设方案

> 目标：在 Cube 开源版之上自建 Analytics Chat（对标 Cube 商业版同名能力）。
> 通路与智能体框架解耦（今天 AgentScope Java，明天可换），口径治理强度不减。
> 讨论定稿：2026-10-12。
> 前置阅读：`补充材料-缺失能力.md`、`01-cube-agent-ask.md`；
> `chat/README.md`（:4100 桥，已退役，仅历史背景）。

---

## 1. 结论摘要

1. **接口长在 Cube 服务本身**：`:4000` 端口内新增 `/agent/*` 契约命名空间，
   经 **preload require-hook 挂载注入**实现——不动镜像、不 clone 源码仓、
   不 build 不 link（不做兄弟服务，已定案）。
2. **一内核两张皮**：REST（`/agent/*`）与 MCP（`/agent/mcp`，Streamable HTTP）
   共用同一组 handler。该形态被 QwenPaw-Data 实装验证（其 MCP 即 REST 代理皮）。
3. **口径知识下沉接口**：组装规则、错误分类、截断协议、词典服务端化；
   框架侧 prompt 只是薄壳，换框架零契约迁移。三态输出契约归 agent
   表达层（Cube 管数据真相，agent 管表达契约）。
4. 本期交付 6 个 REST 端点 + 1 个 MCP 传输端点（见 §5；meta 双粒度）。
5. **判定分工**：相关性（"查不查得了"）由智能体基于全量主题目录判定，
   Cube 侧不做按问聚焦与相关性判断（见 §6.1）。

---

## 2. Cube 官方 Analytics Chat 能力基线（docs.cube.dev，2026-10 取回）

| # | 能力 | 说明 |
|---|------|------|
| 1 | 自然语言问数 | 不写 SQL 直接提问 |
| 2 | 多查询推理 | 复杂问题拆多笔查询再综合；支持临时探索 |
| 3 | Python 分析（preview） | SQL 表达不了的分析，内联渲染、可存为 workbook 报告 |
| 4 | 语义模型集成 + 访问控制 | 全部查询过语义层，遵循 security context |
| 5 | 排队消息 | 智能体处理中可继续发追问，按序处理 |
| 6 | 保存结果 | 存为 workbook 报告或独立 exploration |
| 7 | 组织产物 | 文件夹 list/create/rename/move/delete |
| 8 | 链接产物 | 会话内链接 exploration/workbook/dashboard |
| 9 | 历史 | 重开历史会话 |
| 10 | 字段发现 | "有什么字段/这个指标什么含义"，靠 AI context 回答 |
| 11 | 分享 | 会话只读分享给成员/组织 |
| 12 | 嵌入 | 可嵌入第三方应用 |

关键判读：#1/#2/#4/#10 的质量取决于语义层治理（AI context、口径）——
本项目已有重资产；#5~#9/#11 是平台功能；#3 是旁路。**自建方案的胜负手
在 #4 的口径治理强度，任何接口设计不得削弱它。**

---

## 3. 设计原则与部署定案

### 3.1 三层解耦

```
┌─────────────────────────────────────────────────────────┐
│ 前端契约层（稳定）：三态 answer/ask/nomatch + 构建器回填    │ ← 已有，不动
├─────────────────────────────────────────────────────────┤
│ 智能体层（可换）：AgentScope Java / Claude / 其他           │
│   只做：对话编排、LLM 调用、事件流、会话、HITL               │
│   维护表达层三件套（按客户可改造）：                          │
│     薄壳 prompt + skill + 三态 schema                        │
├─────────────────────────────────────────────────────────┤
│ /agent 契约接口（Cube :4000 内，本次建设）                  │
│   目录/成员 · 查询执行代理 · 诊断 · 词典 · 工具自描述          │
├─────────────────────────────────────────────────────────┤
│ Cube 语义层原生能力（/load /meta /sql）：一行不动            │
└─────────────────────────────────────────────────────────┘
```

三条铁律：

1. **口径知识下沉接口**：口径规则写在工具描述与 meta/词典透出的数据里，
   框架侧 system prompt 压到极薄。换框架 = 重写薄 prompt，契约零迁移。
2. **三态契约与"在构建器中打开"不可破坏**：`tables[].query` 回填构建器
   链路是前端硬约束（`01-cube-agent-ask.md`）。
3. **Oracle 永远只被 Cube 摸**：不提供任何直连库表的 AI 接口
   （对标 QwenPaw 的 execute_sql，明确不学，见 §5 边界）。

### 3.2 部署定案：接口在 Cube 本身（:4000），preload hook 挂载注入

- **机制**：`./preload.js:/preload.js` 是现有启动注入点（已承载 oracledb
  thick、11g 分页改写等补丁），追加一段 hook：拦 http.createServer，
  在 Cube 路由之前认领 `/agent/*` 命名空间（embed-patch 同款模式，该
  通路已在本项目长跑）——认领的路径全量自答，其余原样放行。
  **不动镜像、不 clone 源码仓、不 build 不 link**；不选 yarn link 二开
  （全套工具链成本）与挂载覆盖 dist（动镜像、升级 drift）、兄弟服务
  （已定案接口在 :4000 本体）。
- **路由前缀：顶层 `/agent`**，不塞 `/cubejs-api/v1/` 下——避开网关
  自有路由的通配遮蔽，与端点表一致。
- **零内部依赖原则**：契约模块只依赖 Node 原生 http/fs/crypto，不 import
  网关任何内部模块——`/agent/query` 内部 loopback 调 `:4000/load`，
  meta/unmodel 直接读挂载卷（`conf/model/*.yml`、`conf/unmodel/*.json`）。
- **挂载改动仅一行**：compose 里 `./agent:/cube/agent`（旧 CLI 工具）
  换成 `./agent-api:/cube/agent-api`（契约模块），preload.js 追加 hook 段，
  其余挂载不动。

代码布局（`agent-api/`，纯 CommonJS，依赖 fs/js-yaml 从同进程
`/cube/node_modules` 解析，零打包）：

```
agent-api/
├── index.js       # claim 骨架：bearer 鉴权 + fail-closed 授权表 + 子路由懒加载
├── meta.js        # GET /agent/meta · /agent/meta/:cube（扫 conf/model yml，mtime 缓存）
├── query.js       # POST /agent/query（loopback /load + 错误四分类
│                  #   + truncated 标注 + hitPreAgg 命中自报）
├── unmodel.js     # GET /agent/unmodel/:cube（纯读 conf/unmodel，空册返回"未盘点"）
├── dictionary.js  # GET/POST /agent/dictionary
└── tools.js       # GET /agent/tools（自描述，兼探活与启动握手）
```

- **鉴权**：本地 bearer 中间件读同进程 `CUBEJS_API_SECRET`（hook 挂载在
  网关自有路由之外，checkAuth 覆盖不到，语义一致但不共用实现）。
- **已知代价与对策**：契约进程=网关进程，handler 顶层 try/catch，异常转
  结构化错误，绝不向 http 层抛；yml 扫描按 mtime 缓存；hook 只依赖 Node
  原生 http API（零 Cube 内部形态依赖，升级无探针步骤），失败模式全部
  显性（启动日志缺 `[preload] /agent routes mounted` 行 + `/agent/tools`
  404）；js-yaml 若未提升到根则取 schema-compiler 内部路径。
- **开发循环**：改 `agent-api/*.js` → `docker compose restart cube`
  一条命令；index.js 对子模块懒加载 + `require.cache` 失效，改 handler
  文件不用重启，动 index.js 骨架或 preload hook 段才需 restart。
- **升级故事**：镜像升级 = 冒烟一遍 `/agent/tools` 200 即零动作（hook 只
  依赖 Node http API，无镜像内部形态依赖）；
  转正退路：将来要类型检查时六文件逻辑 1:1 搬进 `src/agent/*.ts` 走
  yarn link，hook 拆除。
- **落地替换**：本项目 `agent/` 三个 CLI js（cube.js/unmodel.js/db.js）
  与 `chat/` 桥退役——问数能力由本目录接口替代（check/meta/query →
  tools/meta/query；unmodel show → unmodel 端点；桥的三态响应 → agent
  侧表达层）；词典文件迁 `conf/agent/dictionary.json`；playground-ext
  不动（前端对接 F0 另行处理）。

---

## 4. 能力 → 接口映射（12 项全覆盖）

| 官方能力 | 谁负责 | Cube 侧接口 |
|---|---|---|
| 1 自然语言问数 | 框架(LLM) + Cube | `meta`（目录定位）+ `query`（失败时成员核验） |
| 2 多查询推理 | 框架(LLM) | 无新端点——`query` 无状态，可连调多笔 |
| 3 Python 分析 | 旁路另议 | 无（SQL API / duckdb-wasm 路线，不进本期） |
| 4 语义集成+访问控制 | Cube | 无新端点——`query` 带 `userId` 留位，securityContext 后置实装 |
| 5 排队消息 | 框架/前端 | 无 |
| 6 保存结果 | 前端（构建器回填/固化链路，已有） | 无（将来要"一句话保存"再加 `POST /agent/explore`） |
| 7 文件夹组织 | 平台 | 无 |
| 8 链接产物 | 前端（`tables[].query` 回填即产物链接，已有） | 无 |
| 9 历史 | 框架/平台 | **无**——历史与日志归框架/平台侧管理 |
| 10 字段发现 | Cube | `meta` 目录面（跨主题定位+模型摘要）+ `meta/{cube}`（成员级+ai_context） |
| 11 分享 | 平台 | 无 |
| 12 嵌入 | 前端 | 无 |

---

## 5. 本期开发清单（6 REST + 1 MCP 传输端点）

| # | 端点 | 方法 | 请求要点 | 响应要点 |
|---|---|---|---|---|
| 1 | `/agent/meta` | GET | —（无参=目录面） | 全部 cubes/views + title + ai_context 摘要（2–5KB 整包，主题定位入口） |
| 2 | `/agent/meta/{cube}` | GET | cube 或 view 名 | 该主题全部 public 成员（`cube.member` 全名 + title/description + **ai_context/includes**） |
| 3 | `/agent/query` | POST | 完整 query JSON + `userId` | data 行 + 错误分类 + `truncated` 标注 + `hitPreAgg` 命中自报 |
| 4 | `/agent/unmodel/{cube}` | GET | cube 名 | 未建模清单，reserve 档标注"源表有料"；未建册时返回"未盘点"结构 |
| 5 | `/agent/dictionary` | GET/POST | 术语 / 拍板条目 | 口径约定 |
| 6 | `/agent/tools` | GET | — | 工具自描述清单；兼作探活与启动握手 |
| 7 | `/agent/mcp` | POST(+GET/SSE) | MCP Streamable HTTP | tools = #1–#6 handler 包装 |

鉴权：本地 bearer 中间件（读同进程 `CUBEJS_API_SECRET`；hook 挂载在网关
自有路由之外，checkAuth 覆盖不到，语义一致但不共用实现），并按 QwenPaw
对标结论做 **fail-closed 授权表**：路由→scope 显式注册，表外默认拒绝；
`dictionary` 的 POST 为写操作，单列 scope。

后续留位：securityContext 实装（#4，`userId` 参数本期就在）；大结果 CSV
下载（若采纳，`query` 返回加 `download_url` + `GET /agent/downloads/{file}`）。

边界（永不进 `/agent`）：原生 `/cubejs-api/v1/load|meta|sql` 一行不动；
`execute_sql` 不做（口径红线）；A2A 不做（问数是工具不是对等智能体）。

---

## 6. 重点接口详解

### 6.1 `GET /agent/meta`（两级：目录面 / 成员全集）

**判定分工原则**："查不查得了"（相关性）由**智能体**基于全量主题目录
判定，Cube 侧不做按问聚焦、不做相关性判断。理由：判定需要"问句语义 +
全量可选项"两个输入，智能体两者都有（question 在手、目录面整包可见），
服务端只有关键词规则——语义判断归 LLM；服务端预聚焦等于服务端决定
智能体看得见什么，规则匹配漏一个主题就是静默失败且无从自我纠正，
全量目录面没有这个问题（现有桥的摘要注入即此形态，系 claude CLI
常驻 prompt 下的 token 妥协）。

**职责**：智能体的"看见模型"入口——官方能力 #10 字段发现 +
SKILL.md 第 2 步"定位主题 / 读口径"的数据来源。

**目录面** `GET /agent/meta`（无参）：

```json
{
  "topics": [
    { "name": "backpay_view", "type": "view", "title": "欠缴主题（交付面）",
      "ai_context_summary": "……一句话口径摘要" },
    { "name": "fiscal_collection", "type": "cube", "title": "……" }
  ]
}
```

体量目标：全量目录 2–5KB，可整包进入 LLM 上下文；按 yml mtime 缓存。

**成员全集** `GET /agent/meta/{cube}`：

- 该主题全部 public 成员：`cube.member` 全名 + title/description +
  **meta.ai_context 与 includes**（SKILL.md"读口径"的无文件版——框架
  侧无文件访问，口径唯一真相经此透出）；
- 实现要点：**直读挂载 yml**（title/description/ai_context/includes 一并
  透出，public 过滤自实现），不混用原生 `/cubejs-api/v1/meta`——避免
  双源漂移，conf 即唯一真相源。

**词典配合**：歧义拍板走 `GET/POST /agent/dictionary`（全量几十条，
可整包拉取或 `?term=` 按词查），本接口不再做词典命中。

### 6.2 契约归属：Cube 管数据真相，agent 管表达契约

三态输出（answer/ask/nomatch）的 JSON Schema 是 agent 的**表达契约**，
与薄壳 prompt、skill 同属表达层资产，按客户/场景可改造——归 agent 侧，
不在 Cube。Cube 侧端点只承载数据真相（meta / query / unmodel /
dictionary / tools）。

- **schema 落点**：agent 工程 `src/main/resources/schema/threestate.v1.json`，
  与 `prompts/ask-system.md`、`skills/cube-ask.md` 构成表达层三件套，
  打包进 agent，启动即读；
- **保证方式**：agent 发帧前经 SchemaValidator 按本地 schema 校验，
  不过不发——从"Cube 服务 schema、前端照它渲染"升级为"生产者主动
  把关"，前端照旧零改动渲染；
- **探活与启动握手**：统一 `GET /agent/tools`（200 + 工具清单可解析）。

不变式随 schema 走（写在字段 description 里，agent 侧守）：
`tables[].query` 必须是完整 Cube query（构建器回填依赖）；`total`
禁止跨口径合计；并列总数合并规则（`22-并列总数合并表.md`）以
`tables` 数组语义表达，不新增字段。版本演进走 v2 新文件 + 表达层
自身版本化，不破 v1。
