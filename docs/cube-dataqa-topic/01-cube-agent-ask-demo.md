# 智能体问数（cube-ask）：功能说明与设计审核基准

> **本文是什么**：用简单直观的语言说清 cube-ask——用户用中文问数据，agent 查 Cube
> 语义层回答。供**回归 ask 的设计审核**用（第六节清单即打勾基准）。
>
> **修正说明（2026-09-28 重写）**：替换 [01-cube-agent-ask.md](01-cube-agent-ask.md)
> （2026-09-22）中已过时的 7 处表述——① view 交付面（"views/ 只有 bill_kpi_view"→
> 实有 12 个，suspicious 有 superv_view）② qa-log 字段清单 ③ 答案载荷（tables
> 平等契约）④ 双执行环境（AskUserQuestion 只在 CLI 成立）⑤ 成员面选择规则
> ⑥ 桥预置上下文注入 ⑦ 失败模式 d 增强。旧文保留作设计沿革。
>
> **权威**：执行契约以 `.claude/skills/cube-ask/SKILL.md` 为准；本文是它的直观解读。

---

## 一、cube-ask 是什么

一句话：**用户用中文问数据问题，agent 把问题翻译成语义层查询，查完按纪律组织
答案——口径可追溯、数字可复算、只查不改模型**（建模/改模型走 cube-modeling skill）。

三个角色：

- **语义层**（`conf/model/` + Cube server）：把"能查什么、怎么算、谁能看"写成
  模型（cube/view yml）。agent 不碰数据库，只发**语义层查询**（cube query，不是 SQL）。
- **agent**（claude 会话）：翻译问题 → 核验成员 → 组装查询 → 组织答案。
- **纪律**（SKILL.md 契约）：五步流程 + 歧义协议 + 成员面规则 + 数字纪律 + 日志，
  把 LLM 的自由度压到最小。

一次问答的完整路径：

```mermaid
flowchart LR
    Q[用户中文提问] --> P[①查询计划表<br/>先展示，再执行]
    P --> V[②meta 核验<br/>成员必须真实存在]
    V --> Qry[③组装 cube query<br/>非 SQL]
    Qry --> EXE[④Cube 编译执行<br/>权限/脱敏在这层生效]
    EXE --> ANS[⑤数字纪律汇总<br/>表+口径声明]
    ANS --> LOG[qa-log 审计落盘]
```

## 二、实例走查：一次问答发生了什么

问："**不同单位当前的可疑票据种类和数量**"
（主题：可疑票据；模型 `conf/model/cubes/facts_stock/suspicious.yml`，交付视图 `superv_view`）

> 口径说明：本例首次实测于 2026-09-22（当时走 cube 层 `suspicious.*`，superv_view
> 尚未交付）。交付视图 `superv_view`（票据监管）交付后，按现行成员面规则（机制 3）
> 走 view 前缀——2026-09-24 同一问题在 chat 桥上实测即走 `superv_view`
> （14 号 §10）。下表为现行口径。

### 第1步：查询计划表（先展示给人看）

| 自然语言 | 映射到 | 依据 |
|---|---|---|
| 不同单位 | `superv_view.agen_name` | view ai_context："单位下钻走 name" |
| 票据种类 | `superv_view.bill_name` | view ai_context（bill_id 技术键不对外） |
| 数量 | `superv_view.suspicious_count` | view ai_context："可疑票据数用 suspicious_count" |
| 当前 | filter: `superv_view.result = '0'` | ⚠️ 歧义已定：词典词条"当前" |

"当前"是真实的歧义：模型自含两套状态口径——处理结果视角 `result='0'`（可疑中，
未解除）与流转状态视角 `status ∈ {'0','1'}`（未通知+待说明，对应 pending_count）。
词典 2026-09-22 定案：**"当前" = result='0'**。

### 第2步：meta 核验（硬 gate）

计划表里**每个成员**必须在 `cube.js meta` 输出里出现——防 LLM 编造成员名。
不在就按失败模式处置（机制 6），不硬查。

### 第3步：组装 query（cube query，不是 SQL）

```json
{
  "measures":   ["superv_view.suspicious_count"],
  "dimensions": ["superv_view.agen_name", "superv_view.bill_name"],
  "filters":    [{"member": "superv_view.result", "operator": "equals", "values": ["0"]}],
  "order":      {"superv_view.suspicious_count": "desc"},
  "limit":      100
}
```

固定规则：filter 只用 `{member, operator, values}`；必带 limit/order；时间范围用
`timeDimensions.dateRange`；成员面优先 view 前缀（机制 3）。

### 第4步：Cube 执行（agent 不用管的部分）

- 编译成 SQL（COUNT DISTINCT FID + GROUP BY + WHERE FRESULT='0'）发 Oracle
- **行级权限**：access_policy 双互补策略——调用带 `securityContext.region_code` 时
  WHERE 自动注入区划过滤；无该属性走 `allow_all` 分支。region_code 虽被 view 排除出
  交付面，cube 层行级过滤对 view 查询**叠加生效**（03 号）。
- **脱敏**：payer_name（交款人）对任何请求方只露末 2 字
- 已知前提：dev 模式 apiSecret 可铸造任意 token（等于可绕过行级权限），权限真正
  强制要等上生产换 JWT 校验（01-design §四 安全边界）

### 第5步：答案（tables 平等契约载荷）

```json
{
  "type": "answer",
  "title": "各单位当前可疑票据的种类和数量",
  "plan": [["不同单位", "superv_view.agen_name", "view ai_context"], ["…"]],
  "tables": [
    {
      "title": "各单位×票据种类（当前=可疑中）",
      "query": { "…": "第3步的 query" },
      "rows":  ["…扁平行数组，一行一对象"],
      "total": 19156
    }
  ],
  "answer": "口径声明：'当前'=处理结果'可疑中'（result='0'，词典词条）。数据范围：仅前 100 组/共 149 组。",
  "assumption": "当前 = result '0'（词典 2026-09-22 定案）",
  "rows": 149,
  "truncated": true
}
```

返回数据节选（2026-09-22 首次走查，同 result='0' 口径）：

| 单位名称 | 票据种类 | 可疑票据数 |
|---|---|---|
| 云南医保测试单位改名 | 云南省医疗门诊收费票据 | 10021 |
| 云南医保测试单位改名 | 云南省医疗住院收费票据 | 2272 |
| 云南考试院测试0615 | 测试-云南省政府非税收入统一票据（电子） | 1544 |

载荷要点（17 号，2026-09-27 起）：

- 需要几个口径就返回几张 `tables[]`，**结构完全对称**——没有"主口径"藏在文本里
- `tables[].total` = 占比分母，由 agent 用**不带 dimensions 的全量查询**拿；
  前端只做除法现算占比列（本例 total=19156 即 result='0' 全量计数）
- `answer` 字段是纯口径声明/拍板结论/数据范围——表格数据不进文本
- 跨口径**不做合计**（09-27 用户拍板）
- 截断标注：rows=149 > limit=100，truncated=true，答案声明"仅前 100 组/共 149 组"

### 第5步收尾：qa-log 审计落盘

一行 JSONL 追加到 `logs/qa-log.jsonl`：

```json
{"time":"2026-09-24T14:30:25+08:00","question":"不同单位当前的可疑票据种类和数量",
 "cube":"superv_view","plan":[["不同单位","superv_view.agen_name","view ai_context"]],
 "queries":[{"…":"各表 query，一条一表"}],"query":{"…":"首表（过渡兼容）"},
 "assumption":"当前=result '0'（词典）","truncated":true,"rows":149}
```

| 字段 | 语义 |
|---|---|
| time | ISO 8601，**+08:00 带偏移** |
| question | 用户原话 |
| cube | 查询主题（cube 或 view 名） |
| plan | 查询计划表 |
| queries | **各表 query 数组（每表一条，09-27 增量；单口径也是长度 1）** |
| query | 首表 query（过渡兼容，读侧迁 queries 后删除） |
| assumption | 口径假设/拍板结论 |
| truncated / rows | 是否可能截断 / 各表行数之和 |
| source | "ui"（chat 桥场景）；桥对 ask/nomatch/error 另补 `answered:false` 审计行 |

### 走查要点

1. **没走 db.js 摸表**——模型是建模时用 db.js 实查验证过才交付的。运行时的信任来自
   "建模时验证 + 编译器"，验证成本付一次。
2. **消费面是交付视图 superv_view**（不是 cube 层）——`conf/model/views/` 现有
   12 个交付 view（superv / daybook / backpay / treasury / usage / writeoff /
   outbound / agen / paybook / bill_kpi / example + view_groups）。可疑票据主题对应
   `superv_view`（view 名取短是因 Oracle 11g 30 字符标识符上限）。
3. **"当前"的歧义靠词典定案**，不靠模型每次重新猜。

## 三、准确性保障：六条机制

原则：五个阶段里 LLM 的自由度不均（①语义解析、⑤汇总回答最高，③组装次之，
②核验、④执行是机械的）。设计 = 每段自由度压到最小 + 每段配机械校验。

### 机制 1：查询计划前置（治①）

执行任何查询前，先产出并展示**查询计划表**：每个自然语言成分 → 成员 + 依据，
歧义显式标记。作用：给用户一个可纠正的中间产物（口径错了一眼能看出来）；
给第2步提供可对单的核验清单。

### 机制 2：歧义处理协议 + 口径词典（治①，最重要的准确率杠杆）

三档协议，**不允许静默选择**：

1. **ai_context 给了多个口径选项**（如"当前"的两套状态口径）→ 先查口径词典：
   有约定直接用并声明；没有 → 用户拍板（方式按执行环境，见四：CLI 用
   `AskUserQuestion`；chat 桥无交互 UI，输出 **ask 三态 JSON**（问题+选项按钮），
   用户点选项后 `--resume` 会话续轮闭环）
2. **ai_context 只有一个明确口径** → 直接用，答案末尾声明
3. **ai_context 没覆盖** → 必须问，不允许猜

**口径词典**（`references/口径词典.md`）：业务高频词 → 项目级约定，已积累
13 个词条（2026-09-28；含泛化词条、双口径词条）。优先级：**ai_context 是成员语义
唯一真相**，词典只映射、不发明成员；两者冲突以 ai_context 为准并提示更新词典。
主题级同义词地图（如 writeoff 的 7 个中文叫法，10 号）是词典的既有落点，词典引用、不重复维护。

### 机制 3：成员面选择规则（治③，2026-09-24 定案）

计划表成员名怎么产，四条规则：

1. **优先 view 前缀**（如 `daybook_view.income_amt`）——消费面统一、与回归基线同面
2. **view includes 未列 → 回退 cube 前缀**（限同底层 cube），计划表注明"view 未含"
3. **跨主题一律走联查 view**（如 `bill_kpi_view.*`）——view 成员与其他 cube 成员
   同查硬报错（实测 `Can't find join path`）；纯 cube 跨 cube 裸拼虽能执行但 join
   语义不可靠（金额全 null 实测）
4. 无交付 view 的主题直接 cube 前缀

### 机制 4：数字纪律（治⑤）

- 只基于返回的 data/rows 行计算（占比、合计、极值），绝不凭记忆补数
- 要合计/占比时**单独发不带 dimensions 的查询**拿全量数字——不能把截断的行加总当
  总数（最隐蔽的错法）
- 返回行数 == limit 时视为可能截断：抬高 limit 重查或补 count 查询，答案标注
  "仅前 N / 共 M 组"
- 已知陷阱：**过滤型度量**（如 income_amt 仅收入方向）分组查询含纯其他方向组合时
  聚合为 null——null 组剔除即答案表（16 号 §6 实测）

### 机制 5：问数日志（治"说不清当时怎么算的"）

每次问答追加一行 JSONL（字段见二）。价值：审计追溯（数字被质疑时还原口径）、
口径歧义考古（高频歧义词进口径词典）、高频问法沉淀为回归用例
（`regress/*.queries.json`，口径变更时 diff 拦住——问数和回归两套体系接上）。

### 机制 6：失败模式处置（第2步核验不过时的硬规则）

成员不在 meta 输出，按序诊断四档，**不允许跳到"建模新 cube"**：

| 档 | 情形 | 处置 |
|---|---|---|
| a 拼写幻觉 | 名字写错 | 对照模型 yml 修正计划名 → 重验 |
| b public:false | meta 不显示非公开成员 | 读 yml 确认存在性；技术键本来就不该查、改计划；业务成员被误藏转 modeling 修可见性 |
| c view 未列 | 成员在 cube 层、view includes 没列 | 回退 cube 层成员直接查，或转 modeling 补交付面 |
| d 真没建模 | yml 全文无相关成员/表 | 默认"查不了" + 精确缺口（哪个 cube 缺什么成员、原料在哪张表），**并声明"yml 未建 ≠ 源表无列"**（ask 只看 yml；需确认源表支持 → 转 modeling 用 db.js 实查） |

- d 档三档处置（① 查不了（默认）② 轻扩展：原料表已建模、只缺成员，走 modeling
  分支②带回归 ③ 新主题走完整六步）**均需用户拍板，不允许自动升级建模**
- 用户拍板"建"且同会话接力时，交接载体 = 会话上下文本身（**不建交接文件**）——
  modeling 侧"第 0 步接力检查"继承已读 yml/meta 结论，改完做增量验收（16 号 §4）
- 后续：撞缺口将先 `ledger.js show <cube>` 再下结论（未建模清单工具，18 号——
  设计定稿，未实施）

## 四、两种执行环境

同一套 SKILL.md 契约，两种触发环境：

| | CLI 直跑（人驱动 claude） | chat 桥（面板问数） |
|---|---|---|
| 入口 | 会话内触发 cube-ask skill | `POST :4100/chat` → 桥 spawn 独立 claude 会话 |
| 模型/词典获取 | 第0步 check + 第1步读模型 yml、读词典 | **预置上下文注入**（见下） |
| 歧义拍板 | `AskUserQuestion` 终端选项 | **ask 三态 JSON**（问题+选项按钮）+ `--resume` 续轮闭环 |
| 最终输出 | 自然对话 | **只输出一个三态 JSON**（answer / ask / nomatch，桥指令约束） |
| 审计 | qa-log | qa-log（`source:"ui"`）+ 桥对 ask/nomatch/error 补 `answered:false` |
| 会话 | 人自己控制 | 空闲超 TTL / 链轮数超上限自动重建（防上下文膨胀） |

**桥预置上下文注入**（2026-09-24 实施，11 号 §10）：桥在首轮 prompt 机械注入三块——
① 模型摘要（每个 cube/view 的 title+成员+description+ai_context，实测 ~30K 字符）
② 通道配方（REST 模板 + docker exec 备选）③ 口径词典全文。配套规则：

- 已注入时**跳过读模型文件与词典**，第0步 check 可跳过——但 **meta 核验（第2步）
  是硬 gate，不省**
- **禁止读 `.env` / docker-compose.yml**（查询通道凭据已预填）
- **每问现扫、零缓存**——改完模型/词典，下一问即生效
- **摘要与 meta 冲突时以 meta 为准**（meta 是编译事实，摘要只是搬运）——即使注入
  过期，新加的成员也只是"摘要里没有"，不会被误判"没建模"

## 五、落地形态与文件布局

```text
.claude/skills/cube-ask/
  SKILL.md              # 执行契约：五步流程、歧义协议、成员面规则、数字纪律、对数触发
  references/
    口径词典.md          # 数据：业务词 → 口径约定（13 词条，越用越厚）
    qa-example.md       # 实例（查询计划表/口径声明长什么样）
logs/qa-log.jsonl        # 问数日志（结果层审计；推理层在 logs/agent/，14 号）
chat/chat_server.py      # 桥：HTTP ⇄ claude（三态透传 + 预置上下文注入 + 补审计）
conf/model/              # 语义层本体（cubes/ views/）——口径唯一真相
```

形态演进：skill 契约先行（2026-09-22）→ chat 桥 + 预置上下文（2026-09-24）→
tables 平等契约（2026-09-27）→ 未建模清单工具（18 号，设计定稿未实施）。
MCP 化仍是将来的体验升级选项（见架构篇），不是本契约的前置。

## 六、设计审核清单（回归 ask 用，逐项打勾）

**流程门**

| # | 审核点 | 出处 |
|---|---|---|
| 1 | 第0步编译检查：编译不过不进入解析；桥预置上下文时可跳过，但 meta 核验不跳 | SKILL.md 第0步 |
| 2 | 查询计划表先展示再执行；歧义处显式标记 | SKILL.md 第1步 |
| 3 | 歧义三档协议：多口径→先词典（有→用并声明，无→拍板）；唯一→声明；没覆盖→必问；不静默选择 | SKILL.md 第1步 |
| 4 | 拍板方式分环境：CLI 用 AskUserQuestion；chat 桥输出 ask 三态 JSON + resume 续轮 | 11 号 §5.2 |
| 5 | meta 硬 gate：计划中每个成员出现在 meta 输出；混合面分别跑 meta | SKILL.md 第2步 |
| 6 | 失败模式 a→b→c→d 逐序诊断；d 档含"yml 未建 ≠ 源表无列"话术；三档处置需用户拍板；不自动建模；不建交接文件 | SKILL.md 第2步、16 号 §4 |
| 7 | 组装规则：优先 view 前缀 / view 未含回退 cube（限同底层）/ 跨主题走联查 view；filter 只用 member/operator/values；必带 limit(默认100)+order；时间用 timeDimensions.dateRange | SKILL.md 第1/3步 |
| 8 | 截断检查：行数==limit → 抬高 limit 或补 count 查询；答案标注"仅前 N / 共 M 组" | SKILL.md 第4步 |
| 9 | 答案必含：结果表 + 口径声明（含拍板结论）+ 数据范围（组数/截断） | SKILL.md 第5步 |
| 10 | 数字纪律：只基于返回行计算；合计/占比用不带 dimensions 的全量查询；禁把截断行加总 | SKILL.md 第5步 |
| 11 | 高风险对数触发：金额度量 / 用户明说对外汇报 / 数字将写入文档 → db.js 直查 Oracle 比对一次 | SKILL.md 第5步 |
| 12 | qa-log 必落盘：字段齐全（time(+08:00)/question/cube/plan/queries/query/assumption/truncated/rows[/source]） | SKILL.md 第5步、14 号 §4.1 |

**载荷与词典**

| # | 审核点 | 出处 |
|---|---|---|
| 13 | tables 平等契约：每口径一张表 `{title,query,rows,total}`；无 data 字段；answer 为纯口径声明；跨口径不合计；占比 = 行值/表级 total（前端现算） | 17 号 §2 |
| 14 | 词典维护：拍板后立即回写；只映射不发明成员；与 ai_context 冲突以 ai_context 为准 | SKILL.md、词典 |
| 15 | 桥预置上下文：每问现扫零缓存；注入时跳过读文件、禁读 .env；摘要与 meta 冲突以 meta 为准 | 11 号 §10 |

## 七、关联文档

- [01-cube-agent-ask.md](01-cube-agent-ask.md)：2026-09-22 设计沿革（本文修正其中 7 处过时表述）
- [01-cube-agent-architecture.md](01-cube-agent-architecture.md)：架构（组件怎么连接、MCP 形态）
- [11-chat-agent开发计划-v2.md](11-chat-agent开发计划-v2.md)：chat 桥、三态契约、预置上下文注入（D3）
- [14-日志规格.md](14-日志规格.md)：qa-log 字段与路径的权威规格
- [16-问数到补建模的闭环流程.md](16-问数到补建模的闭环流程.md)：失败模式 d 增强、同会话三段式、增量验收
- [17-多口径表前端渲染.md](17-多口径表前端渲染.md)：tables 平等契约权威定义
- [18-未建模清单.md](18-未建模清单.md)：ledger.js 工具（失败模式 d 的后续增强，未实施）
- [10-易混淆主题名称.md](10-易混淆主题名称.md)：主题级同义词地图（词典引用，不重复维护）
