# 27 - agent-chat 智能体搭建与交互 Cube 方案

> 目标：从 0 搭建独立的 AgentScope Java 智能体服务（agent-chat），经
> `/agent/*` 契约接口与 Cube 交互；两者独立部署，唯一共享物是契约。
> 姊妹篇：`27-agent接口与AnalyticsChat建设方案.md`（Cube 侧契约接口）。
> 讨论定稿：2026-10-12。参考：`.claude/skills/cube-ask/SKILL.md`（问数契约）。

---

## 1. 总选型：示例基座，不从零写

`agentscope-chat` 官方示例（agentscope-java 仓内，JDK17 + Maven 即跑，
默认离线 demo 模型、零外部依赖）直接当 Agent 服务基座。它自带：

| 我们需要的 | 示例已有 | 说明 |
|---|---|---|
| 会话持久化 + 历史（官方能力 #9） | AgentSession + 日志目录，重启恢复、多会话 | GET /api/sessions 现成 |
| 排队消息（#5） | submit 排队 / steer 运行中引导 / inject 只补材料 | 三入口齐 |
| 三态 ask 的 HITL | ask_user 工具 → suspended → 前端输入框 → POST /answers 续跑 | **ask 的机制化实现** |
| SSE 流式 + 断线续传 | GET /stream?after=cursor + Last-Event-ID + 快照恢复 | 前端 chat.js 连 UI 都带 |
| 中断恢复 | checkpoint + resume（turnId 不变 runId 换） | 问数中途取消/续问直接用 |
| 工具注册点 | ChatSessions.java 构建 HarnessAgent + Toolkit | **唯一要动：换 CubeTools** |
| 模型配置 | CHAT_MODEL 环境变量（demo 离线模式） | 先离线跑通再切 GLM |

示例定位声明：本地单进程单用户、无认证——正是 P1/P2 竖切要的形态，
生产化（认证/容量/多用户）排 P3。

---

## 2. 部署拓扑

```
┌─ Cube 部署（现仓库）────────┐      ┌─ Agent 部署（agentscope-java 克隆仓）────┐
│ cube:4000                   │      │ agentscope-chat 示例改造                  │
│  ├─ /cubejs-api/v1/*  原生   │ ◀────│  ├─ config 层        模型选择 → GLM      │
│  ├─ /agent/*  契约接口 6 个  │ REST │  ├─ agent 层         HarnessAgent 装配   │
│  └─ /agent/mcp（P2）         │ 或MCP│  ├─ tools 层         6 工具 → /agent/*   │
│ 凭据：CUBEJS_API_SECRET      │      │  ├─ client 层        HTTP/token/超时     │
└─────────────────────────────┘      │  ├─ workspace（记忆/会话日志，自己的盘）   │
                                     │  └─ web 层（SSE 出口 :8087 → 前端）       │
                                     └───────────────────────────────────────────┘
```

独立性四不共享：**网络**（两个独立 compose 项目，跨边界走宿主机端口 +
token）、**文件系统**（agent 不挂载 conf、不 docker exec 进 cube 容器，
模型真相全部经 `/agent/meta` 透出）、**会话状态**（`/agent/*` 全部无状态，
多轮上下文在 agent 侧 workspace）、**版本**（启动握手 `GET /agent/tools`：
200 + 工具清单可解析，失败 fail fast）。各自 up/down、各自升级、可分机。

---

## 3. 交互时序（五步 + 分支，落到示例机制上）

| 步 | 动作 | 示例基座上的落点 |
|---|---|---|
| 1 确认就绪 | GET /agent/tools（探活兼工具清单拉取） | 服务启动时做一次（fail fast）；首轮拉目录面时天然复检 |
| 2 看见模型 | GET /agent/meta 目录面 2–5KB 整包 | CubeTools 工具一，LLM 定位主题 |
| 3 读口径 | GET /agent/meta/{topic} 成员 + ai_context/includes | CubeTools 工具二 |
| 4 生成 query | LLM 内部，不调接口 | 组装规则写在工具描述与 skill 里 |
| 5 执行 | POST /agent/query {query, userId} | CubeTools 工具三；错误分类驱动条件步 |
| 歧义 ask | GET /agent/dictionary → 无约定 → 问用户 → POST /agent/dictionary 回写 | **ask_user 工具复用**：挂起 → 前端输入框 → /answers 续跑，turnId 不变 |
| 查不了 nomatch | GET /agent/unmodel/{cube} → 三态 nomatch + 缺口 | 条件步 d |
| 最终输出 | answer/ask/nomatch 结构化对象 | 按 resources/schema/threestate.v1.json 约束产出（SchemaValidator 发帧前校验），经 SSE 持久帧带给前端 |

与 SKILL.md 四步一一对应，skill 平移只改数据来源描述
（"读 view yml"→"调 meta/{cube}"、"docker exec cube.js check"→"启动握手"）。

---

## 4. Agent 侧改造清单（标准目录 + 分层）

### 4.1 标准目录（分层 + 出处标注）

```
agent-chat/
├── pom.xml                                       # [改] +agentscope-extensions-model-{openai|anthropic}
├── config/
│   └── application.yml                           # [新增] cube.base-url/token、glm.*、超时（集中一处）
├── deploy/
│   ├── Dockerfile                                # [新增] JDK17 运行镜像
│   └── docker-compose.yml                        # [新增] 独立部署单元（P3 启用）
├── src/main/java/<pkg>/agentchat/
│   ├── config/                                   # ① 配置层（横切，最底层，被所有人依赖）
│   │   ├── AppProperties.java                    #    [新增] 配置绑定
│   │   └── ModelConfig.java                      #    [改自 ChatApplication] GLM 接法
│   ├── client/                                   # ② 通路客户端层（只管 HTTP，不懂业务）
│   │   ├── CubeClient.java                       #    [新增] Bearer/超时(query 120s)/网络重试一次/编码
│   │   ├── dto/                                  #    [新增] 各端点请求响应对象
│   │   └── SchemaValidator.java                  #    [新增] 三态输出按本地 schema/threestate.v1.json 校验
│   ├── tools/                                    # ③ 工具层（@Tool 壳：参数 ↔ client 调用）
│   │   └── CubeTools.java                        #    [新增] 6 工具（D2 竖切先 3 个）；口径规则写在工具描述
│   ├── agent/                                    # ④ 智能体层（装配与执行编排）
│   │   ├── ChatSessions.java                     #    [改] Toolkit 注册 CubeTools；sysPrompt=薄壳
│   │   └── AgentBootstrapper.java                #    [新增] 启动握手：/agent/tools，fail fast
│   └── web/                                      # ⑤ 交互出口层（示例原样，尽量不动）
│       ├── ChatController.java                   #    [不动] turns/answers/steer/inject/interrupt/resume
│       ├── ChatHistory.java / ChatItems.java     #    [不动]
│       └── static/（chat.js 等）                  #    [不动] 自带前端
└── src/main/resources/
    ├── prompts/ask-system.md                     # [新增] 薄壳 prompt：角色 + 四步骨架 + 三态输出
    ├── skills/cube-ask.md                        # [新增] SKILL.md 平移，数据来源换接口
    └── schema/threestate.v1.json                 # [新增] 三态输出契约（表达层三件套：prompt+skill+schema）
```

运行时 `workspace`（记忆、会话日志）为外部目录（CHAT_WORKSPACE 指定、
挂卷持久），不进代码树；prompt/skill 打包在 resources，由 agent 层启动
时装载；会话历史落 workspace。

### 4.2 分层依赖规则（单向，禁止反向/跨层）

```
web ⑤ → agent ④ → tools ③ → client ② → config ①
```

- tools 层不发 HTTP（细节全在 client），不懂三态语义之外的业务；
- agent 层不做参数转换、不拼 HTTP；
- **口径规则的唯一落点：③ 工具描述 + resources/skill**——换框架重抄的
  只有这两份薄文件；
- web 层零业务感知，SSE 只透传事件。

### 4.3 改造要点

| 文件 | 动作要点 |
|---|---|
| config/ModelConfig.java | GLM 两条接法都试：① openai 扩展 + 兼容端点 baseUrl；② anthropic 扩展 + GLM 的 Anthropic 兼容端点（claude CLI 现走的那条），取通者 |
| client/CubeClient.java | baseUrl、Bearer（env 注入不进仓库）、超时（query 120s / 其余 30s）、网络错误重试一次 |
| tools/CubeTools.java | 6 @Tool 对应 6 端点（dictionary 查/写两工具对一端点）；D2 竖切先写 3 个（meta 目录面 / meta/{cube} / query） |
| agent/ChatSessions.java | HarnessAgent.Builder：sysPrompt 薄壳、workspace 外部目录、Toolkit 挂 CubeTools |
| agent/AgentBootstrapper.java | 启动即握手 /agent/tools（200 + 清单可解析），失败拒绝启动 |
| resources/skills/cube-ask.md | 四步骨架 + 歧义拍板 + 条件步诊断；数据来源换接口 |
| web/*、static/* | 不动 |

---

## 5. 分阶段（对接 27-agent 接口文档 P0–P3）

| 阶段 | 内容 | 验收 |
|---|---|---|
| D0 | 克隆构建示例，离线 demo 模型跑通 /slow、/ask 全流程 | 排队、HITL、断线续传三点当场验证 |
| D1 | 切 GLM；**思考控制杠杆验证（生死关，不过则延迟回 473s 级）** | GLM 下响应节奏可接受 |
| D2 | CubeTools 三工具竖切 | 真实财务问题 → /agent/query → 与构建器手工对数一致 |
| D3 | 六工具齐 + skill 平移 + 按本地 schema 结构化输出 | 端到端：流式过程 + 三态答案；ask 分支走 ask_user |
| P2 | MCP 皮：AgentScope 挂 /agent/mcp，工具逻辑不动 | 同题同口径双皮对照 |
| P3 | 认证加固、多用户 securityContext、compose 化独立部署 | 示例"单进程单用户无认证"边界在此收口 |

---

## 6. 验证点与边界重申

- **GLM 思考杠杆**是唯一可能推翻进度的项（CLI `--effort low` 压 14 倍的
  等价物），D1 第一件事；
- 结构化输出若框架原生模式对不上三态嵌套，降级：prompt 约束 + agent 侧
  按 schema 校验后发帧（SchemaValidator 就位）；
- 边界不变：agent 不碰模型文件、不直连 Oracle、无 execute_sql；前端永远
  不直连 Cube；
- 待拍板：P1 验收用示例自带聊天页（8087），ext-chat/构建器回填对接放
  D3 尾（SSE 尾帧带 tables[].query，前端按现有三态渲染）——建议前者，
  前端零风险、联调面最小。
