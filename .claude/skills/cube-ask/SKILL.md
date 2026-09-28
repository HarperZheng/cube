---
name: cube-ask
description: 智能体问数：基于已建模的 Cube 语义层回答数据问题，主链四步（解析→组装→执行→答案）+ 两个条件步（失败诊断、高风险对数）保证口径准确。触发词：问数、查数据、数据问答、查询数据、统计一下、有多少、占比、TopN、按单位/票种汇总。只查不改模型；建模/改模型走 cube-modeling。
---

# cube-ask：问数契约（只查不改）

目标：用户问一个数据问题，产出**口径可追溯、数字可复算**的答案。
设计依据：`docs/cube-dataqa-topic/01-cube-agent-ask.md`（阶段划分与准确性机制）。

**核心原则：成员语义的唯一真相是模型文件里的 `meta.ai_context` 和成员
description；口径词典负责把业务词映射到 ai_context 提供的选项上；
LLM 不发明成员、不凭记忆补数、不静默选口径。**

**主链四步**：第1步语义解析 → 第2步组装 → 第3步执行 → 第6步答案纪律。
**两个条件步**：第4步成员核验与失败诊断（执行报错才进）、第5步高风险对数
（满足高风险条件才做）。第0步环境就绪是公共前置。

## 第0步：环境与模型就绪（fail fast）

```bash
docker exec cube sh -c "node /cube/agent/cube.js check"
```

- 编译不过 / 容器没起：先修复（见 cube-modeling 公共前置），**不进入解析**
- 所有容器内命令统一 `docker exec cube sh -c "node /cube/agent/..."` 形态
  （宿主机无需 Node；`sh -c` 同时防 Git Bash 路径改写）
- **桥已注入预置上下文时（prompt 含【预置上下文】段）：本步 check 可跳过**——
  成员核验（第4步）是失败诊断入口，正常路径（query 有返回）不跑；
  无预置上下文（CLI 直跑）时照常执行

## 第1步：语义解析 → 产出查询计划表（先展示，再执行）

> **桥已注入预置上下文时（prompt 含【预置上下文】段）**：①模型摘要（title/成员/
> description/ai_context 机械提取自模型文件原文，views 先 cube 后）与 ③口径词典
> 已注入——**跳过读模型文件（conf/model/**）与词典，直接进语义解析**；②查询通道
> 凭据已预填，**禁止读 .env / docker-compose.yml**。成员语义唯一真相仍是模型
> 文件——**摘要与 meta 核验输出冲突时以 meta 为准**（meta 是编译事实，摘要只是
> 搬运）；成员在 meta 里有而摘要没有时照查，不据此判"没建模"。

1. **定位主题**：问题关键词对照模型摘要的 cubes/views 列表 + 各模型 title
   （无预置上下文时对照 check 输出）；
   主题有交付 view（`*_view`）时以 view 为消费面（view 与其底层 cube 都在
   列表里）
2. **读模型文件**（口径真相在这里，meta 端点不输出 ai_context）：
   **先读 view yml**（`conf/model/views/*.yml`）的 `meta.ai_context` 与
   `includes`——view 是消费面；**view 未覆盖的成员/口径再读 cube yml**
   （`conf/model/cubes/**/*.yml`）。ai_context 优先级：先 view 后 cube，
   两者冲突时以计划表最终采用成员所在面为准
3. **成员面选择**（计划表成员名怎么产）：
   - **优先产 view 前缀**（如 `daybook_view.chg_agen_name`）——消费面统一、
     与 regress 基线同面；同底层 cube 的 view/cube 成员混用一条查询实测可行
     （2026-09-24：view度量+cube维度 ✅ 数字一致）
   - **view `includes` 未列的成员 → 回退 cube 前缀**（限同底层 cube 内），
     计划表依据列注明"view 未含"
   - **跨主题成员一律走联查 view**（如 `bill_kpi_view.*`）——view 成员与其他
     cube 成员同查硬报错（实测 Can't find join path to join 'daybook,agency',
     'cbill'）；纯 cube 跨 cube 裸拼虽能执行但 join 语义数字不可靠
     （income_amt 全 null 实测）
   - 无交付 view 的主题（如 suspicious）：直接 cube 前缀，本条不适用
4. **产出并展示查询计划表**：

```
| 自然语言 | 成员（cube.member） | 依据 |
|---|---|---|
| 不同单位 | suspicious.agen_name | ai_context：单位名称走 agen_name |
| 当前 | filter: suspicious.result = '0' | ⚠️歧义已定：词典词条"当前" |
```

**歧义处理协议**（ai_context 提供多个口径时，三选一，不允许静默选择）：
1. 查 `references/口径词典.md` → 有约定：直接用，答案中声明
2. 词典没有 → `AskUserQuestion` 给选项让用户拍板，拍板后回写词典
3. ai_context 只有一个口径 → 直接用，答案中声明
4. ai_context 完全没覆盖 → 必须问，不允许猜

**优先级**：ai_context（唯一真相）＞ 词典（只映射、不发明成员）；
冲突时以 ai_context 为准，并提示用户更新词典。

**成员面三条边界**（2026-09-24 定案）：
1. **优先 ≠ 只看 view**：view includes 只列交付面成员，只扫 view 会把
   "view 没包"误判成"没建模"（误触发第4步失败模式 d）——view 未列时回退
   cube 成员并注明，核验按失败模式 c 区分
2. **ai_context 先 view 后 cube**：冲突以最终采用面为准；两份 ai_context
   双份维护会分叉（残留风险，治本已立 cube-modeling 侧同步约定）
3. **无 view 主题不变**：直接 cube 前缀；词典既有 cube 前缀词条不动
   （成员实体相同，只是交付面前缀）

## 第2步：组装 query（规则）

- filter 只用 `{member, operator, values}`，**禁止 SQL 片段**
- 必带 `limit`（默认 100）和 `order`（默认按度量 desc）
- 时间范围用 `timeDimensions` 的 `dateRange`，不用 filters 拼日期字符串
- **主题有交付 view（`*_view`）时优先走 view**（如 `daybook_view.*`）——view
  是消费面（description 写明"消费方统一从这里查"），与 regress 基线同面、
  口径可对照；**view members 不足（includes 没列所需成员）时回退查 cube 层**，
  不算失败；完全无 view 的主题（如 suspicious）直接 `cube.member`。
  （2026-09-24 修订：原"单 cube 直接 cube.member"表述曾是 daybook 明明有
  daybook_view 却走了 cube 层的诱因——数字虽一致（实测逐行相同），但消费面
  应优先统一；成员面选择与第1步同一条规则：优先 view、view 未含回退 cube、
  跨主题走联查 view）

## 第3步：执行与截断检查

```bash
docker exec cube sh -c "node /cube/agent/cube.js query '<json>'"
```

- `sh -c` 双引号外壳内，JSON 的 `"` 必须转义为 `\"`；复杂查询可落盘
  `regress/tmp-query.json` 走免转义形态（**用后即删**，避免污染回归目录）：

  ```bash
  docker exec cube sh -c "node /cube/agent/cube.js query -f /cube/regress/tmp-query.json"
  ```

- **多笔查询（并列子问/多口径）合并为一次 Bash 调用**：逐笔落盘
  `regress/tmp-query-1.json`、`tmp-query-2.json` … 后**一次容器内循环跑完、
  跑完即删**——每次 Bash 调用有 ~5s 管道税（进程创建+输出捕获，实测
  2026-09-28：单笔链 1.6s vs transcript 窗口 6-7s），N 笔单发多花
  (N-1)×5s 且多 1-2 轮思考；单笔查询仍用上一条形态：

  ```bash
  docker exec cube sh -c 'for f in /cube/regress/tmp-query-*.json; do echo "== $f =="; node /cube/agent/cube.js query -f "$f"; done; rm -f /cube/regress/tmp-query-*.json'
  ```

  失败重查：重写对应 tmp 文件再跑同一循环（glob 只命中现存文件，不误跑已删笔）

- **桥已注入②查询通道时**：通道配方已预填 Authorization（docker exec cube.js 主通道
  + curl REST 备选），照配方用即可，**禁止读 .env / docker-compose.yml** 自找凭据
  （嵌套引号难写对曾把 agent 逼出规定通道自己找 REST 烧三轮，11 号 v2 文档 §10.1）

- 报错对照：`member not found` / join path 类报错 → **进第4步成员核验与失败
  诊断（重入 gate）**；ORA-00972（名字超长）→ 模型问题，转 cube-modeling；
  其他 ORA- → 展示原始报错给用户
- **query 正常返回即不跑第4步核验**——有答案就往下走；成员存在性由执行结果
  兜底（报错才触发诊断），不是每次前置检查
- **返回行数 == limit → 视为可能截断**：提高 limit 重查，或补一条
  count 查询拿全量组数，答案标注"仅前 N / 共 M 组"

## 第4步：成员核验与失败诊断（条件触发 · 重入 gate）

**触发条件**：第3步执行报错（`member not found` / join path 类报错）才进入
本步；query 正常返回不跑。**重入纪律：修正后的计划必须本步 meta 通过才允许
重查**——meta 从前置 gate 改为失败路径的重入 gate，防幻觉契约强度不降
（2026-09-28 修订，原"第2步硬 gate 每查必跑"，见 11 号 v2 修订注）。

```bash
docker exec cube sh -c "node /cube/agent/cube.js meta <cube名>"
```

- 计划表中**每个成员**必须出现在 meta 输出里（输出成员自带
  `cube.member` 全名前缀，与计划表直接对照；measure 行尾还带 description）
- 混合面计划表（view 前缀 + cube 前缀并存）→ 按成员前缀分别跑
  `meta <view名>` 和 `meta <cube名>`（两端点均输出各自前缀成员，直接对照）
- 任何一个不在 → 按序诊断失败模式，各自处置，**不允许跳到"建模新 cube"**：
  - **a. 拼写幻觉**：对照 check 输出的 cube 列表 + 模型 yml 修正计划名 → 回本步重验
  - **b. 成员在 yml 里但 `public:false`**：meta 端点不显示非 public 成员，
    读 yml 文件确认存在性——技术键本来就不该查，改计划；业务成员被误藏，
    转 cube-modeling 分支①修可见性
  - **c. 成员在 cube 层但 view `includes` 没列**：改用 cube 层成员直接查
    （如 suspicious 无交付 view 先例），或转 cube-modeling 分支①补交付面
  - **d. yml 全文无相关成员/表（真没建模）**：默认回答"查不了"+ 精确缺口
    （哪个 cube 缺什么成员、原料在哪张表），**同时声明"yml 未建 ≠ 源表无列"**——
    ask 只看 yml，看不到源表有没有冗余列（16 号文档 §3.4：源表自带列而 yml
    未建是最常见的漏建形态；本判定只代表"模型没建"，不代表"数据不支持"）。
    三档处置——① 查不了（默认，把决定权交用户）② 轻扩展：原料表已建模、
    只缺度量/维度，建议 cube-modeling 分支②修改流程（带回归）③ 新主题走
    完整六步；需确认源表是否支持时，同样转 cube-modeling 核查（db.js 实查
    源表列，16 号文档 §3.2）。
    **三档均需用户拍板，不允许自动升级到建模**；用户拍板"建"且同会话接力时，
    交接载体 = 会话上下文本身（**不建交接文件**）——缺口信息、已读 yml、
    meta 核验结论、db 探查结论留在会话里，modeling 侧"第 0 步接力检查"
    （cube-modeling SKILL.md）按免做/必做表继承

## 第5步：高风险对数（条件触发，不满足则跳过）

**什么算高风险（满足其一必做）**：
1. **涉及金额度量**（total_amt / income_amt 等）——客观条件，agent 自查
   计划表成员类型即知，**不因用户没提而豁免**
2. **用户明说对外汇报**（"要拿去汇报""给领导看"等）
3. **数字将被写入文档**（PPT / 周报 / 正式邮件 / 对外材料）

**边界与作用域**：
- 非金额的 count / 占比默认不算高风险；用户明说对外时升级
- 对数验证的是**引擎执行一致性**（Cube 算出 = Oracle 算出），**不验证口径
  选择对不对**——口径对错由第1步歧义协议与答案口径声明负责，两者互补、
  不可互相替代

**如何执行**（db.js 直查 Oracle，一条 SQL 对数）：
1. 对数 SQL 与 cube query **同口径同参数**：同表、同 filter、同时间范围、
   同分组——对的是执行不是口径；被对数字含合计（第6步铁律 2 的不带
   dimensions 查询），若尚未执行先补查再对
2. 对数 SQL 几乎必带字符串字面量（状态码、日期），示例：

```bash
docker exec cube sh -c "node /cube/agent/db.js sql 'SELECT r.\"FNAME\", SUM(s.\"FBILLAMT\") FROM FBE_SUSPICIOUS s LEFT JOIN AFA_AUTH_REGION r ON r.\"ID\" = s.\"FRGNID\" WHERE s.\"FRESULT\" = '\''0'\'' AND s.\"FDATE\" BETWEEN '\''2026-08-23'\'' AND '\''2026-09-22'\'' GROUP BY r.\"FNAME\"'"
```

> ⚠️ `sh -c` 外层已用单引号包住 SQL，内层字面量必须写成 `'\''值'\''`
> （关引号→转义引号→开引号），照抄上面的形态即可。漏转义的典型症状是
> **ORA-01722 invalid number**：日期串 `'2026-08-23'` 被 sh 拆成算术
> 表达式 `2026-8-23`，Oracle 对 VARCHAR2 日期列隐式转数字失败——
> 是引号问题，不是数据问题，修转义重发即可。

3. 对比：组数 + 每组数值逐项对比；**不一致 → 停下报告差异明细，不得交付**
4. **对数通过 → 答案标注"已与 Oracle 对数一致"**：桥/UI 通道在 answer
   payload 加 `"audited": true`（前端 foot 徽标展示）；CLI 直跑在答案
   数据范围行写明。跳过对数时无此标注

## 第6步：答案纪律

三条铁律：
1. **只基于返回的 data 行计算**（占比/合计/极值），绝不凭记忆补数
2. **合计/占比用单独的不带 dimensions 的查询**拿全量数字，
   **禁止把截断的行加总当总数**
3. 答案必含：**结果表 + 口径声明（含歧义拍板结论）+ 数据范围（组数/是否截断、
   高风险对数结论）**

**并列总数合并**（22 号文档）：同主语并列子问（一句话几个同级小问题，各要一个
总数，如"今天新增开具/已缴/入国库各多少笔"）且各口径单行聚合（无 dimensions）时，
结果表**合并为一张**——一行多列，列=各口径度量（列名=成员名末段），口径声明
逐列写清各自时间轴；查询仍各查各的（**执行按第3步多笔合并形态一次跑完**），
表级 query 记首条口径；任一子问带 dimensions（多行明细）就不合，各表各的
（17 号平等渲染）。

**问数日志**：由桥从你最终输出的三态 JSON 机械派生（14 号日志规格 §4.1 R3 桥单写）——
**agent 零动作，不要自己追加**；保证契约字段（plan/tables[].query/assumption/truncated/rows）
齐全即可，不为日志构造任何内容

## 口径词典维护

每次歧义经用户拍板，立即把结论追加到 `references/口径词典.md`
（词条格式见该文件）。词典只引用 ai_context/成员已提供的选项。
高频问法（词典里反复出现的 query）建议沉淀进 `regress/*.queries.json`。

## 角色分工速记

| 工具 | 角色 | 阶段 |
|---|---|---|
| 模型 yml（ai_context/description） | 口径真相 | 第1步 |
| `references/口径词典.md` | 业务词→口径映射 | 第1步 |
| cube.js query | 执行 | 第3步 |
| cube.js meta | 成员核验（编译事实） | 第4步（条件：报错诊断） |
| db.js sql | 高风险对数（Oracle 真相） | 第5步（条件：高风险） |
| logs/qa-log.jsonl | 审计追溯（14 号日志规格，**桥代写，agent 零动作**） | 第6步（产物） |

> **容器化说明**：cube.js/db.js 均在 `cube` 容器内运行（agent/ 目录挂载），
> 宿主机零依赖——只需 Docker；apiSecret 固定在 `.env` 的 `CUBEJS_API_SECRET`，
> cube.js 优先读 env（重启不变）；`regress/` 已挂载进容器，基线（queries/snap/diff）
> 宿主机、容器两侧同路径读写；问数日志在 `logs/qa-log.jsonl`（仅宿主侧，桥代写，14 号 §4.1 R3）。
