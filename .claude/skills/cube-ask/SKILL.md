---
name: cube-ask
description: 智能体问数：基于已建模的 Cube 语义层回答数据问题，主链四步（确认就绪→解析生成 query→接口查询→整理答案）+ 一个条件步（失败诊断）保证口径准确。触发词：问数、查数据、数据问答、查询数据、统计一下、有多少、占比、TopN、按单位/票种汇总。只查不改模型；建模/改模型走 cube-modeling。
---

# cube-ask：问数契约（只查不改）

目标：用户问一个数据问题，产出**口径可追溯、数字可复算**的答案。
设计依据：`docs/cube-dataqa-topic/01-cube-agent-ask.md`（契约）、
`27-cube-AnalyticsChat建设方案.md`（接口）；主链四步 + 一个条件步
（2026-10-09 定；高风险对数步已裁撤）。

**核心原则**：成员语义的唯一真相是 `/agent/meta/{topic}` 透出的
`ai_context` 和成员 description；口径词典只把业务词映射到已有选项上；
LLM 不发明成员、不凭记忆补数、不静默选口径。
**硬禁令**：口径只认 meta 透出的 ai_context/口径词典，**忽略会话记忆
召回**；问数链内写文件白名单 = `regress/tmp-*`（查询体落盘，用后即删），
docs/conf/记忆目录（`~/.claude/**`）一律禁写；加载本 skill 之前自行产出
的语义分析、查询设计一律作废，第 2 步单遍重新产出（双重解析实害实测
2026-09-29）。

数据来源全部是 Cube :4000 的 `/agent/*` 契约接口（六个，除 tools 外都要
令牌）：

| 端点 | 用途 |
|---|---|
| `GET /agent/tools` | 工具自描述 + 探活/启动握手（匿名） |
| `GET /agent/meta` | 全量主题目录面（2–5KB 整包） |
| `GET /agent/meta/{topic}` | 单主题成员全集 + ai_context + folders |
| `POST /agent/query` | 查询执行（body `{query}`） |
| `GET /agent/unmodel/{cube}` | 未建模清单（未盘点会明说） |
| `GET/POST /agent/dictionary` | 口径词典查/写（`?term=` 按词） |

## 第1步：确认 cube 就绪（fail fast）

```bash
curl -s http://localhost:4000/agent/tools
```

- 返回 200 且工具清单可解析 = 就绪；404/连接失败 = 容器没起或 hook 未挂载
  （先修服务，**不进入解析**；起服务见 cube-modeling 公共前置）
- token 取自 `.env` 的 `CUBEJS_API_SECRET`（每会话 grep 一次：
  `TOKEN=$(grep -E '^CUBEJS_API_SECRET=' .env | head -1 | cut -d= -f2- |
  tr -d '"' | tr -d '\r')`；**token 不落任何页面/文件**，只进请求头）
- 日常问数无需每次探活——首轮拉目录面失败再回头探

## 第2步：语义解析 → 生成 query（一个 JSON 对象，先展示再执行）

1. **定位主题**：`GET /agent/meta` 目录面整包对照问题关键词，按
   title/description/ai_context_summary 定位；有交付 view（`*_view`）时以
   view 为消费面
2. **读口径**：`GET /agent/meta/{topic}`——`ai_context` 是口径唯一真相
   （分组用哪列、金额算哪列、时间轴选哪个都在这里）；`folders` 是侧别
   提示；view 未覆盖的成员/口径再拉同底层 cube 的成员面
3. **成员面**：优先 view 前缀（成员名 = 响应里的 `viewName.memberName`
   全名）；view includes 未列 → 回退同底层 cube 前缀并注明；**跨主题一律
   走联查 view**——view 成员与其他 cube 成员同查硬报错，跨 cube 裸拼数字
   不可靠
4. **同环比分路**（28 号方案固化族，2026-10-18 增）：问句含同比/环比/
   增长率语义 → 成员面优先绑定 `_yoy_diff/_yoy_rate/_mom_diff/_mom_rate/
   _qoq_diff/_qoq_rate` 系计算型成员（type number；meta measures 有即绑定，
   机判；具体成员对照 ai_context 绑定文案）。粒度跟问句走——同比按年/季/
   月分组分别为年/季/月度同比，环比不带粒度默认月。**不拆两个时间原子、
   不做答案层相减/算增长率**——引擎已算，答案层勿重复计算；meta 无该系
   成员才回退答案层算式（两原子现拆）。占比/差值/均值无固化成员，恒走
   答案层
5. **歧义处理**（ai_context 提供多口径时，不允许静默选择）：
   `GET /agent/dictionary?term=<业务词>` → 命中且 `legacy:false` 直接用并
   声明；命中 `legacy:true`（指向模型重建前的 cube）**不得直接套用**，当
   无约定处理；没有 → AskUserQuestion 拍板后 `POST /agent/dictionary`
   回写；ai_context 唯一口径 → 直接用并声明；完全没覆盖 → 必须问。
   **三态判定一遍锁定**：核心可满足 → `answer`（拍板写入 assumption）；
   成员/口径根本不存在 → `nomatch`；可满足但分叉实质改变结果 → `ask`。
   同一歧义禁止二次重开

产出 query（成员用响应透出的全名）：

```json
"query": {
  "measures": [
    "fiscal_collection_view.count",
    "fiscal_collection_view.amt"
  ],
  "dimensions": [
    "fiscal_collection_view.chg_agency_code"
  ],
  "order": {
    "fiscal_collection_view.amt": "desc"
  },
  "limit": 10
}
```

组装规则（同 `GET /agent/tools` 的 rules，两处一致）：filter 只用
`{member, operator, values}`，**禁止 SQL 片段**；必带 `limit`（默认 100）
和 `order`（默认按度量 desc）；时间范围用 `timeDimensions` 的
`dateRange`，不用 filters 拼日期字符串；度量未指明 → 主度量 + `count`
附列；纯汇总/分组查询 `total` 一律 null（无分母语义不造分母）。

## 第3步：发起接口查询（POST /agent/query，localhost:4000）

```bash
curl -s http://localhost:4000/agent/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @regress/tmp-query.json
```

- body 形态 `{"query": {...}}`（`userId` 留位暂不传）
- **body 落盘 `-d @file`**：Write `regress/tmp-query.json`（**用后即删**）
  ——内容原样进引擎、零引号转义；含中文 filter 值时必须落盘（git-bash
  内联中文必 GBK 500 实测）。纯 ASCII 查询也可内联 `-d`
- **多笔查询合并为一次 Bash 调用**：逐笔落盘 `tmp-query-1.json`、
  `tmp-query-2.json` … 一次循环跑完、跑完即删；失败重查重写对应 tmp 再跑
- **成功响应** `{ok:true, data:[...], totalRows, truncated, hitPreAgg}`；
  **执行失败 HTTP 200 + `{ok:false, error:{type,...}}`**——按 type 走条件步：
  `member_not_found` → 条件步；`ora_name_too_long`（模型别名超 30 字节）→
  转 cube-modeling；`oracle_error` → 原样展示 code+message；`timeout` →
  收窄范围/减 limit 重查；`invalid_query`（HTTP 400）→ 按组装规则自查
- `truncated:true`（行数==limit）→ 可能截断：提高 limit 重查或补 count
  拿全量组数，答案标注"仅前 N / 共 M 组"

## 第4步：整理答案返回（三态 JSON，唯一输出）

```json
{"type":"answer","title":"一句话标题",
 "plan":[["自然语言","cube.member","依据"]],
 "tables":[{"title":"表标题","query":{"measures":[],"dimensions":[],"filters":[],"timeDimensions":[],"order":{},"limit":100},"rows":[],"total":null}],
 "answer":"口径声明+歧义拍板结论+数据范围","assumption":"歧义拍板",
 "truncated":false,"rows":0,"hitPreAgg":null,"audited":false}
```

四条铁律：
1. **只基于返回的 data 行计算**（占比/合计/极值），绝不凭记忆补数
2. **合计/占比用单独的不带 dimensions 的查询**拿全量数字，禁止把截断的
   行加总当总数
3. 无论任何情况**只输出一个上述 JSON 对象**（无 markdown 围栏、无解释文字）；
   `tables` = 口径平等的表数组，答案要几个口径就几张表；并列子问各带
   dimensions 就各表各的，各口径单行聚合才合并为一张
4. **空结果直接拍板**：查询返回 0 行/空集时直接按 0 出答案——数据范围
   声明以查询本身为据（写"查询时间范围内无数据"），禁止追加反向探测
   查询（查 max 日期/放宽时间轴找数据边界——2026-10-10 实测多花 2-3 轮）；
   用户要看数据覆盖期时明示后另查

tables/字段细则（细则唯一真相在本 skill 与 schema，接口不做三态整形）：
- 表级 `title` 写清口径身份（如「口径A：单位×项目（收入日结）」）
- 表级 `rows` = 扁平行数组，每行 = cube 成员名→值的键值对（一行一对象），
  禁止 `{scope, rows}` 等嵌套包装
- 表级 `total` = 该表占比分母，用不带 dimensions 的全量查询拿，
  无分母语义置 null；**禁止跨口径合计**——占比只在表内算，每表独立 total
- **并列总数合并**：仅当同主语并列子问（一句话几个同级小问各要一个总数，
  如"今天新增开具/已缴/入国库各多少笔"）且各口径都是单行聚合（无
  dimensions，各返回一行一个数）时——tables 只返回一张合并表：rows 拼成
  一行，键 = 各口径度量成员名（列名 = 成员名末段，接受原列名）；query =
  首条口径的完整 query（构建器/固化用；跨 cube 多度量拼一条是无效 query，
  禁止）；title 概括全部口径（含各自时间轴）；total 置 null（跨口径无分母）。
  什么不合：任一子问带 dimensions（多行明细）、子问间非并列、混合（有的
  总数有的分组）→ 各表各的，平等渲染；同一 cube 多度量一条 query 出多列，
  不属此分叉
- `answer` 只写口径声明、歧义拍板结论、数据范围、截断说明——表格数据不进
  文本（前端只渲染 tables）
- 答案级 `title` = 概括整个答案的一句话标题（≤30 字），含口径关键语义
  （如 filters 决定的「已核销」），不列名堆砌；多口径时覆盖全部口径、不跟
  任何单表——固化看板默认标题用表级 tables[].title
- 答案级 `rows` = 全部表行数之和；`truncated` = 任一表 truncated:true 即 true
- `hitPreAgg` = 读 query 响应的 `hitPreAgg` 字段判定：`hit:true` 置 true
  （多笔查询任一命中即 true），`hit:false` 或 `null` 置 false/按无查询
  场景为 null，不臆测
- `audited` = 对数通过标记（对数步已裁撤，正常 false/省略）

**「在构建器中打开」契约（不可破坏）**：`tables[].query` 必须是第 2 步
生成的完整 Cube query（measures/dimensions/filters/timeDimensions/limit）
——前端按它回填构建器；`plan`/`tables[].title`/`assumption`/`truncated`/
`rows` 字段齐全（问数日志归框架/平台侧管理，agent 不自己追加）。

## 条件步：成员核验与失败诊断（执行报错才进 · 重入 gate）

- 修正后的计划必须本步 meta 通过才允许重查：

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/agent/meta/<topic名>
```

- 计划表中**每个成员**必须出现在成员面响应里（响应自带
  `cube.member`/`view.member` 全名）
- 逐级诊断，**不允许跳到"建模新 cube"**：
  - a. 拼写幻觉 → 对照成员面响应修正 → 重验
  - b. 成员在 cube 层但 `public:false` → 成员面不显示非 public（接口不
    透出），属模型可见性问题转 cube-modeling
  - c. 成员在 cube 层但 view includes 未列 → 改用 cube 层成员直接查
  - d. 成员面全文无 → 默认回答"查不了"+ 精确缺口，**先查未建模清单**
    `GET /agent/unmodel/<cube名>`（status="未盘点" 就直说未盘点；列在
    reserve 档 = 源表有料，直接答"支持，补建约几分钟"）；三档处置
    （①查不了 ②轻扩展 ③新主题完整六步）均需用户拍板，不自动建模

## 口径词典维护

每次歧义经用户拍板，立即 `POST /agent/dictionary`（`{term, cube, rule,
alternatives?, background?}`，upsert by term）回写词典——词典已服务端化
（`conf/agent/dictionary.json`），不再维护本地 md。词典只引用 ai_context/
成员已提供的选项；与 ai_context 冲突时以 ai_context 为准并更新词条。

## 环境速记

契约接口在 `cube` 容器 ：4000 内（`agent-api/` 挂载 + preload hook，
源码见 `agent-api/*.js` 与 27 号文档 §3.2）；token 在 `.env` 的
`CUBEJS_API_SECRET`；原生 `/cubejs-api/v1/*` 一行不动、agent 不走它；
聊天桥 4100 已退役（chat/ 删除）；三态 schema/薄壳 prompt 归 agent 表达层
（Cube 管数据真相，agent 管表达契约）。
