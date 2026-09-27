---
name: cube-ask
description: 智能体问数：基于已建模的 Cube 语义层回答数据问题，五步契约保证口径准确。触发词：问数、查数据、数据问答、查询数据、统计一下、有多少、占比、TopN、按单位/票种汇总。只查不改模型；建模/改模型走 cube-modeling。
---

# cube-ask：问数契约（只查不改）

目标：用户问一个数据问题，产出**口径可追溯、数字可复算**的答案。
设计依据：`docs/cube-agent-ask.md`（五阶段与准确性机制）。

**核心原则：成员语义的唯一真相是模型文件里的 `meta.ai_context` 和成员
description；口径词典负责把业务词映射到 ai_context 提供的选项上；
LLM 不发明成员、不凭记忆补数、不静默选口径。**

## 第0步：环境与模型就绪（fail fast）

```bash
docker exec cube sh -c "node /cube/agent/cube.js check"
```

- 编译不过 / 容器没起：先修复（见 cube-modeling 公共前置），**不进入解析**
- 所有容器内命令统一 `docker exec cube sh -c "node /cube/agent/..."` 形态
  （宿主机无需 Node；`sh -c` 同时防 Git Bash 路径改写）
- **桥已注入预置上下文时（prompt 含【预置上下文】段）：本步 check 可跳过**——
  meta 核验（第2步）仍是硬 gate；无预置上下文（CLI 直跑）时照常执行

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
   "view 没包"误判成"没建模"（误触发第2步失败模式 d）——view 未列时回退
   cube 成员并注明，核验按失败模式 c 区分
2. **ai_context 先 view 后 cube**：冲突以最终采用面为准；两份 ai_context
   双份维护会分叉（残留风险，治本已立 cube-modeling 侧同步约定）
3. **无 view 主题不变**：直接 cube 前缀；词典既有 cube 前缀词条不动
   （成员实体相同，只是交付面前缀）

## 第2步：成员核验（硬 gate）

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
    （哪个 cube 缺什么成员、原料在哪张表），三档处置——
    ① 查不了（默认，把决定权交用户）② 轻扩展：原料表已建模、只缺度量/维度，
    建议 cube-modeling 分支②修改流程（带回归）③ 新主题走完整六步。
    **三档均需用户拍板，不允许自动升级到建模**；用户明确说"建"时，
    把缺口信息作为 cube-modeling 对应分支的输入交接

## 第3步：组装 query（规则）

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

## 第4步：执行与截断检查

```bash
docker exec cube sh -c "node /cube/agent/cube.js query '<json>'"
```

- `sh -c` 双引号外壳内，JSON 的 `"` 必须转义为 `\"`；复杂查询可落盘
  `regress/tmp-query.json` 走免转义形态（**用后即删**，避免污染回归目录）：

  ```bash
  docker exec cube sh -c "node /cube/agent/cube.js query -f /cube/regress/tmp-query.json"
  ```

- **桥已注入②查询通道时**：REST 形态（Invoke-RestMethod + Authorization 预填）在
  PowerShell 环境优先用，免嵌套转义（docker exec 嵌套引号实测是 agent 绕路
  自己找通道的诱因，11 号 v2 文档 §10.1）；meta 核验同理可走 `/v1/meta`

  ```bash
  docker exec cube sh -c "node /cube/agent/cube.js query -f /cube/regress/tmp-query.json"
  ```

- 报错对照：`member not found` → 回第2步；ORA-00972（名字超长）→
  模型问题，转 cube-modeling；其他 ORA- → 展示原始报错给用户
- **返回行数 == limit → 视为可能截断**：提高 limit 重查，或补一条
  count 查询拿全量组数，答案标注"仅前 N / 共 M 组"

## 第5步：答案纪律

三条铁律：
1. **只基于返回的 data 行计算**（占比/合计/极值），绝不凭记忆补数
2. **合计/占比用单独的不带 dimensions 的查询**拿全量数字，
   **禁止把截断的行加总当总数**
3. 答案必含：**结果表 + 口径声明（含歧义拍板结论）+ 数据范围（组数/是否截断）**

**高风险对数**（满足其一必做：涉及金额度量（如 total_amt）/ 用户明说
对外汇报 / 数字将被写入文档）：用 db.js 直查 Oracle 对数一条，不一致 →
停下报告，不得交付。对数 SQL 几乎必带字符串字面量（状态码、日期），示例：

```bash
docker exec cube sh -c "node /cube/agent/db.js sql 'SELECT r.\"FNAME\", SUM(s.\"FBILLAMT\") FROM FBE_SUSPICIOUS s LEFT JOIN AFA_AUTH_REGION r ON r.\"ID\" = s.\"FRGNID\" WHERE s.\"FRESULT\" = '\''0'\'' AND s.\"FDATE\" BETWEEN '\''2026-08-23'\'' AND '\''2026-09-22'\'' GROUP BY r.\"FNAME\"'"
```

> ⚠️ `sh -c` 外层已用单引号包住 SQL，内层字面量必须写成 `'\''值'\''`
> （关引号→转义引号→开引号），照抄上面的形态即可。漏转义的典型症状是
> **ORA-01722 invalid number**：日期串 `'2026-08-23'` 被 sh 拆成算术
> 表达式 `2026-8-23`，Oracle 对 VARCHAR2 日期列隐式转数字失败——
> 是引号问题，不是数据问题，修转义重发即可。

**追加问数日志**（每次必做，一行 JSONL，追加不覆盖；路径 14 号日志规格：logs/qa-log.jsonl）：

```bash
mkdir -p logs && echo '{"time":"<ISO时间，+08:00 带偏移，如 2026-09-24T14:30:25+08:00>","question":"<原话>","cube":"<cube名>","plan":[["不同单位","suspicious.agen_name","ai_context"]],"queries":[<tables 各表 query JSON，一条一表（单口径也是长度 1 的数组）>],"query":<首表 query JSON（过渡兼容：读侧迁 queries 后删除）>,"assumption":"<口径假设，如 当前=result 0（词典）>","truncated":<true|false>,"rows":<各表行数之和>}' >> logs/qa-log.jsonl
```

## 口径词典维护

每次歧义经用户拍板，立即把结论追加到 `references/口径词典.md`
（词条格式见该文件）。词典只引用 ai_context/成员已提供的选项。
高频问法（词典里反复出现的 query）建议沉淀进 `regress/*.queries.json`。

## 角色分工速记

| 工具 | 角色 | 阶段 |
|---|---|---|
| 模型 yml（ai_context/description） | 口径真相 | 第1步 |
| `references/口径词典.md` | 业务词→口径映射 | 第1步 |
| cube.js meta | 成员核验（编译事实） | 第2步 |
| cube.js query | 执行 | 第4步 |
| db.js sql | 高风险对数（Oracle 真相） | 第5步 |
| logs/qa-log.jsonl | 审计追溯（14 号日志规格） | 第5步 |

> **容器化说明**：cube.js/db.js 均在 `cube` 容器内运行（agent/ 目录挂载），
> 宿主机零依赖——只需 Docker；apiSecret 固定在 `.env` 的 `CUBEJS_API_SECRET`，
> cube.js 优先读 env（重启不变）；`regress/` 已挂载进容器，基线（queries/snap/diff）
> 宿主机、容器两侧同路径读写；问数日志在 `logs/qa-log.jsonl`（仅宿主侧，14 号）。
