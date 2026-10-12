# 问数五步规程（S1–S5）

> 状态：**规程稿**——2026-10-12 定稿。把自然语言查数问题转换为语义层可执行的 query JSON，或在不可执行时给出转办结论。
> 挂载点：cube-ask 主链四步的第 2 步（解析生成 query）。
> 配套：[28-查数五步SOP](28-查数五步SOP.md)（初版叙述）、[口径词典](../../.claude/skills/cube-ask/references/口径词典.md)、三个交付 view 的 `ai_context`（`conf/model/views/*.yml`）

---

## 一、定位

| 项 | 内容 |
|---|---|
| 输入 | 自然语言查数问题 |
| 输出 | query JSON（成员全名引用，filter 仅 `{member, operator, values}` 形态）或转办结论 |
| 执行前提 | meta 与口径词典可获取（见 S1 输入） |
| 失败处置 | 失败原子不进入后续步骤，单独输出并附原因，禁止构造近似查询替代 |

## 二、五步规程

### S1 口径原子化

- **输入**：
  1. 自然语言问题；
  2. 成员清单与口径文案，固定来自两处：
     - **接口** `GET /cubejs-api/v1/meta`（带认证 token）——返回各 view 全部成员：measures / dimensions 的 name、title、type，各成员 `description`，view 的 `ai_context`；
     - **文档** `.claude/skills/cube-ask/references/口径词典.md`——业务口径中文对照。
- **过程**：
  1. 按并列标记（顿号、逗号、"以及"）拆子问句，每个子问句恰含一个数量词；无数量词的为省略语境，结合上文补全或终止确认；
  2. 逐子问句**直达识别**三元组，各槽位对照 meta 清单与口径词典直接落点，不经过中间归类表：
     - **主语事实** ← 业务实体名词，保留原文、不翻译、不路由（路由是 S2 职责）；
     - **度量语义** ← 数量词的自然语义（笔数 / 单据数 / 金额 / 实物量），并按 meta 中度量 title/description 预判落点成员方向；成员全名的绑定是 S3 职责；
     - **约束** ← 限定语的约束形态（状态过滤 / 时间窗 / 分组），仅记形态与原文值；成员全名的绑定是 S4 职责。
- **输出**：原子集合 `[{主语事实, 度量语义, 约束}]`。
- **规则**：
  1. 枚举外语义（比率、平均、分位数）不是数数诉求 → 标记计算型，不产生原子，直接交 S5 判定；
  2. 槽位无法填充且无法从上文补全 → 标记「待确认」，不得凭空补值；
  3. 主语不同的原子保持独立，是否可合并到 S2 路由后复核；
  4. 识别落点与 meta / 口径词典冲突时（量词指向模型不存在的度量语义）→ 按「待确认」处理，不得迁就问题改口。

### S2 主语路由

- **输入**：
  1. S1 输出的原子集合；
  2. view 语义域信息，固定来自两处（与 S1 同源）：
     - **接口** `GET /cubejs-api/v1/meta`（带认证 token）——各 view 的 title、description、`ai_context`（语义域分工与口径文案，如 treasury 的 ai_context 首句"缴库入库视图，一行一笔缴库明细（缴库单×科目）"即名词域锚点）；
     - **文档** `.claude/skills/cube-ask/references/口径词典.md`——业务名词归属对照。
- **过程**：
  1. 逐原子取「主语事实」名词与约束值，对照各 view 的 title / description / `ai_context` 文案及口径词典词条匹配；命中唯一 view → 写入路由标签，成员搜索域收缩为 meta 中该 view `includes` 的成员清单（S3/S4 仅在此清单内选成员）；
  2. 名词命中多个 view → 按序消解：① 约束值线索（如"已入国库"仅出现在 treasury 的 ai_context 语境）② 原子内修饰语 ③ 仍歧义 → 标记「待确认」，不得默认；
  3. 名词在两处来源均无匹配 → 终止，向提问方确认业务含义；确认产生的新名词**先补录入口径词典**（涉及口径分工的同步补入对应 view 的 `ai_context`），**再重新路由**，禁止临时推断；
  4. 单原子需多数据域支撑 → 不强行路由，标记跨表，交 S5 第 3 项判定。
- **输出**：带路由标签的原子集合 `[{主语事实, 度量语义, 约束, view}]`。
- **规则**：
  1. 路由一对一，一个原子恰对应一个 view，跨域诉求一律拆解为多原子或转 S5，不存在混合路由；
  2. 路由失败（无匹配/歧义未消/跨域）的原子不进入 S3，单独输出并附失败原因；
  3. 匹配依据仅限上述两处来源，禁止凭会话记忆或常识推断路由。

### S3 度量绑定

- **输入**：
  1. S2 输出的带路由标签原子集合；
  2. 度量成员信息，固定来自两处（搜索域已由 S2 收缩至该路由 view）：
     - **接口** `GET /cubejs-api/v1/meta`（带认证 token）——该 view 的 measures 清单：name、title、**type**（count / countDistinct / sum / max / avg / min）、description；
     - **文档** 该 view 的 `ai_context`（`conf/model/views/*.yml`）中的度量口径文案；`.claude/skills/cube-ask/references/口径词典.md` 作业务名词对照。
- **过程**：
  1. 按「度量语义」在搜索域内以 **type 字段筛选**（机判，不经分类表）：笔数 → `type=count`；单据数 → `type=countDistinct`；金额 → `type=sum`；实物量 → 受限可加成员（见规则 3）；
  2. 候选唯一 → 绑定成员全名（view 限定名，如 `fiscal_treasury_view.count`）；候选多个 → 用原子的修饰语/约束值对照成员 title / description 与 `ai_context` 口径文案消歧（如"缴款金额" amt vs"到账金额" entered_amt）；仍无法消歧 → 列出全部候选并附口径差异，标记「待确认」；
  3. 粒度两可（笔数 vs 单据数）→ 按该 view `ai_context` 的粒度口径文案判定（treasury 已写明：缴库单数用 bill_count，明细笔数用 count）；文案未覆盖 → 两者均输出。
- **输出**：原子 + 度量成员全名。
- **规则**：
  1. 成员绑定仅限 S2 搜索域（该 view `includes` 清单），禁止引用 cube 层未进 view 的成员；
  2. 金额诉求仅接受 `type=sum` 的度量——`type=max / avg / min` 的金额成员自动排除在候选之外（机判，不依赖逐名记忆）；其使用场景仅限明细下钻（drill_members）；
  3. 实物量成员（如 `exec_qty`）仅当查询含对应计量单位维度分组时可选，否则按「待确认」处理；
  4. 语义落点在搜索域内无对应成员（如量词指向 view 未覆盖的度量语义）→ 按「待确认」处理，不得迁就问题改口，也不得跨 view 借成员。

### S4 约束绑定

- 目的：为原子确定过滤维度与时间维度。
- 操作：状态语义 → 枚举 string 维度（`state`、`enter_status` 等）；时间语义 → time 维度（`pay_date`、`eff_date`、`build_date`、`enter_date` 等）。
- 规则：
  1. 枚举取值从 dimension `description` 复制，禁止推测；
  2. 时间维度按口径绑定规则选择：「已入国库」统计时间轴为 `enter_date`（仅入库成功行有值），缴库量趋势为 `build_date`（建单日），两者业务含义不同，不得互换；
  3. 分组维度用 `*_code`，`*_name` 为别名拼接结果，仅作展示。

### S5 可行性判定

- 目的：执行前拦截语义层不支持的查询形态，禁止构造近似查询替代。
- 判定项：
  1. **列间运算**（日期差等跨列派生）→ 不支持：查询 API 仅接受已声明成员引用，无表达式求值能力 → 转模型层衍生度量（如 `avg(dateDiff(...))`）；
  2. **分位数聚合**（P95 等）→ 不支持：标准聚合类型仅 sum/avg/min/max/count/countDistinct → 明细导出后外部计算；
  3. **跨宽表合并**（原子路由标签不同且需返回同一数字）→ 不支持 join：单查询成员必须同源 → 拆分为多条查询，结果层拼接；
  4. **动态相对时间窗口**（距今 N 天）→ 受限：`dateRange` 为静态日期区间 → 换算为具体日期，并在答案中声明窗口边界。
- 输出：全部通过 → 生成 query JSON；任一命中 → 按对应处置转办。

## 三、贯穿示例

「今天新增开具多少笔、已缴多少笔、已入国库多少笔」

- S1 → 三原子：`{开具, 笔数, timeRange=今天}`、`{缴款书, 笔数, filter=已缴}`、`{缴库, 笔数, filter=已入国库}`（度量语义槽为自然语义，非成员名）；
- S2 → 前两者路由 `fiscal_collection_view`，第三者由约束线索（"入国库"仅出现在 treasury 的 ai_context 语境）路由 `fiscal_treasury_view`；原子 1、2 同 view 但口径不同（开票行为 vs state 过滤），保持独立；
- S3 → 各原子在路由 view 的 measures 内按 type 筛选：度量语义均为笔数 → `type=count`，collection 与 treasury 各唯一命中，分别绑定 `fiscal_collection_view.count`、`fiscal_treasury_view.count`；treasury 的粒度文案（ai_context："缴库单数用 bill_count，明细笔数用 count"）判定"多少笔"为明细笔数，排除 `bill_count`（type=countDistinct）；
- S4 → 约束成员绑定：原子 1 时间轴 `pay_date`（当日区间）；原子 2 状态维度 `state`（取值从 description 复制）；原子 3 状态维度 `enter_status`（取值 '1'）+ 时间轴 `enter_date`（"已入国库"统计口径，勿用 build_date）；
- S5 → 三条 query 均未命中四类边界 → 产出三条独立 query。

## 附录 A：量词语义核对表（非执行依据）

**性质**：对 S1 直达识别结果的分类核对清单，不参与执行。用途仅两项：① 模型度量清单变更后，核对量词语义覆盖面是否仍有落点；② 执行者不掌握模型（或需将流程固化为确定性程序）时，作为显式映射依据。

**度量语义（4 类，源自三 view 全部度量的穷举归纳）**：

| 语义 | 典型量词 | 落点方向 | 备注 |
|---|---|---|---|
| 笔数 | 多少笔/条/个 | count 系 | collection.count、allocation.count、treasury.count |
| 单据数 | 多少张单/票 | countDistinct 系 | treasury.bill_count |
| 金额 | 多少钱/金额 | sum 系 | amt / entered_amt / im_amt / trans_amt |
| 实物量 | 多少吨/千瓦时 | 受限可加 | collection.exec_qty，仅按计量单位分组时可加 |

**约束形态（3 类，源自 Cube 查询协议参数空间）**：状态/分类过滤 → filter；时间窗 → timeRange；分组诉求 → groupBy。

**排除项（1 项）**：`total_amt`（缴款票面、缴库单票面）——整票金额复印于明细行，max-only，任何场景不作度量候选。
