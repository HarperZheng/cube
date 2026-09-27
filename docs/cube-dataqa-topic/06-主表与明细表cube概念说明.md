# 06 主表与明细表 cube 概念说明（以 cbill / cbill_item 为例）

> 用途两句话：**cbill 是"开票主表"（一张票一行），cbill_item 是"开票明细"
> （一张票下每个收费项目一行）**——两者是主表 ↔ 明细表（1:N）关系；
> 下钻查询靠**双向 join + drill_members** 实现（P3 定案）。
> 实际文件：[cbill.yml](../../conf/model/cubes/facts_cbill/cbill.yml)、
> [cbill_item.yml](../../conf/model/cubes/facts_cbill/cbill_item.yml)。

---

## 一、主表和明细表的关系

### 1.1 数据关系：1:N，靠外键 FPID 关联

```
UNE_CBILL（主表，一张票一行）          UNE_CBILL_ITEM（明细表，一票多行）
┌──────────────────────────┐          ┌──────────────────────────────┐
│ FID  = 'xxx'   ←─┐       │    1     │ FPID = 'xxx'  FAMT = 水费部分 │
│ FTOTALAMT = 整票金额      │ ───────> │ FPID = 'xxx'  FAMT = 检查费部分│
│ FSTATE / FBUSTYPE...     │    N     │ FNUMBER / FITEMNAME...        │
└──────────────────────────┘          └──────────────────────────────┘
                          关联键：FPID → FID
```

- 主表一行 = 一张开票记录（FID 跨月唯一，32317=32317 已验证）；
- 明细表一行 = 该票下的**单个收费项目**（一张票含 3 个项目就是 3 行）；
- 所以**明细行数 ≥ 票数**，两边的 count 不能直接比大小；
- 注意**票号 bill_no 跨月不唯一**——票号按月重新编号（如 0000000003 在 12 个月
  里都出现），跨表唯一标识只有 FID（技术主键，不对外）。"单票"要
  bill_no + bill_month 组合定位（见 1.4 数据示例）。

### 1.2 cube 层关系：各自建 cube，互不预 join

| | **cbill**（主表，P3 建） | **cbill_item**（明细表，P0 建） |
|---|---|---|
| **粒度** | 一票一行 | 一票可多行（按收费项目拆开） |
| **典型度量** | receipt_count（**countDistinct fid 去重**）、total_amount、normal/void_count、4 个业务金额 | item_count（**count FPID 不去重**）、total_amount、total_number |
| **独有维度** | bill_no（票号）、state、bus_type、payer_name（脱敏）——状态/业务属性只在主表 | item_code / item_name（收费项目）——分项目分析只有明细表有 |
| **金额来源** | FTOTALAMT（整票金额） | FAMT（单项目金额） |

为什么要分两个 cube：原指标体系"**含项目/不含项目**"两套口径就靠这两个粒度
承担——看"开了多少张票"用 `cbill.receipt_count`（一票计 1），看"各收费项目
开了多少"用 `cbill_item`（按 item_name 分组）。混在一个 cube 里 count 会口径
混乱（01-design.md §11 风险第 4 条）。

### 1.3 join 层关系：双向有向边（P3 定案）

Cube 的 join 是**有向的**（docs/05），主表↔明细各声明一条、方向相反：

```
        one_to_many（反向，供 drill_members）
  cbill ────────────────────────────> cbill_item
        <────────────────────────────
        many_to_one（belongs_to，核心）
```

```yaml
# cbill_item.yml（明细侧，belongs_to 主表）——核心
joins:
  - name: cbill
    sql: "{CUBE}.\"FPID\" = {cbill}.\"FID\""
    relationship: many_to_one

# cbill.yml（主表侧，反向 one_to_many）——供 drill_members 原生下钻
joins:
  - name: cbill_item
    sql: "{CUBE}.\"FID\" = {cbill_item}.\"FPID\""
    relationship: one_to_many
```

- 两条边方向相反，**不存在多路径歧义**（docs/05）；
- `cbill_item` 的 agency/item join **未声明**——join 只声明需要的
  （02 约定第 6 条）；
- 安全性：FID 主键跨月唯一 + Cube 靠主键处理 fan trap（docs/05）；
  行级权限跨成员取交集（docs/11）。

### 1.4 数据示例（真实数据，2026-09 实测）

取票号 `0000000003` 在 **2025-01** 的数据，直观展示"一张票一行 → 一项目一行"。

**主表 cbill**——3 张票就是 3 行（状态/业务类型/缴款人只在这里有）：

| bill_no 票号 | bill_month | bill_date 开票日期 | state 状态 | bus_type 业务类型 | payer_name（脱敏） | total_amount |
|---|---|---|---|---|---|---|
| 0000000003 | 2025-01 | 2025-01-04 | 1 正常 | 4 直缴转开票 | **财政 | 200 |
| 0000000003 | 2025-01 | 2025-01-04 | 1 正常 | 1 常规开票 | **三1 | 100 |
| 0000000003 | 2025-01 | 2025-01-01 | 1 正常 | 3 冲销开票 | **换开 | -1811.88 |

**明细表 cbill_item**——每个收费项目一行（项目编码/名称只在这里有）：

| item_code 项目编码 | item_name 项目名称 | count 明细行数 | total_amount |
|---|---|---|---|
| 1030106001 | 铁路建设基金收入 | 2 | 300 |
| 530002 | 检查费 | 1 | -1811.88 |

对应关系：两张铁路建设基金收入票（200 + 100）→ 2 条明细行合计 300；一张
冲销检查费票 → 1 条明细行 -1811.88（冲销为负数）。主表 3 行 ↔ 明细 3 行，
靠 FPID → FID 关联。

这个例子同时说明三件事：

| 现象 | 结论 |
|---|---|
| 3 张主表行、每行有 state/bus_type/payer_name | 状态/业务属性**只在主表** |
| 明细按项目拆行、有 item_code/item_name | 分项目分析**只在明细表** |
| 同一票号 3 张不同缴款人的票；0000000003 在 12 个月里都出现 | **bill_no 不唯一**，跨表唯一标识是 FID；"单票"要 bill_no + bill_month 组合 |

---

## 二、如何实现维度下钻查询

下钻分两个方向、两种机制：

### 2.1 方向一：明细侧下钻（查主表属性）—— belongs_to join

**场景**：查明细时想按主表属性过滤/分组（"这一张票的明细"、"作废票的分项目
分布"）。belongs_to join 使**主表维度向明细传递**（docs/12"维度向下传"）：

```json
// 票号下钻：一条查询完成（实测通过；注意 bill_no 跨月不唯一，见 1.4）
{ "measures": ["cbill_item.count", "cbill_item.total_amount"],
  "dimensions": ["cbill_item.item_name"],
  "filters": [{ "member": "cbill.bill_no", "operator": "equals", "values": ["0000000003"] }] }

// 单票下钻：bill_no + bill_month 组合定位一张（组）票（实测通过，返回 2 个项目）
{ "measures": ["cbill_item.count", "cbill_item.total_amount"],
  "dimensions": ["cbill_item.item_name", "cbill_item.item_code"],
  "filters": [{ "member": "cbill.bill_no", "operator": "equals", "values": ["0000000003"] },
              { "member": "cbill.bill_month", "operator": "equals", "values": ["2025-01-01"] }] }

// 按主表状态分析明细（实测通过）
{ "measures": ["cbill_item.count"],
  "dimensions": ["cbill_item.item_name"],
  "filters": [{ "member": "cbill.state", "operator": "equals", "values": ["2"] }] }
```

### 2.2 方向二：主表侧原生下钻 —— drill_members（模型声明，非查询格式）

**场景**：主表聚合查询后，点击某个单元格直接返回明细字段。实现方式是在主表
度量上声明 `drill_members`（docs/02-measures：可含 join cube 的维度）：

```yaml
# cbill.yml——这是模型层声明（写在度量上），不是一条可执行的查询
measures:
  - name: receipt_count
    drill_members: [cbill.bill_no, cbill_item.item_name, cbill_item.item_code]
```

**它不是 REST API 查询格式**：没有对应的查询 JSON、不能 POST 到
`/cubejs-api/v1/query`——查询侧（measures/dimensions/filters）只负责出聚合数，
drill_members 只是给**前端**（Playground/BI 工具）看的"下钻配置"：前端点击
单元格时，按这份声明自己构造明细查询。Core 也**无 `/v1/drill` 端点**
（实测 Cannot POST）。REST API / AI 代理要明细时用方向三兜底。

### 2.3 方向三：两步查询下钻（REST 兜底，无需 drill_members）

主表定位"桶" → 明细 cube 用同一过滤值再查。两个 cube 共享的键（bill_month /
region_code / agency_code / 时间范围）在明细表里都有同源冗余列，可直接平移：

```json
// 第 1 步：主表定位（2026-09 有 59 张票）
{ "measures": ["cbill.receipt_count"],
  "timeDimensions": [{ "dimension": "cbill.bill_date", "dateRange": ["2026-09-01", "2026-09-30"] }] }

// 第 2 步：明细 cube 用同一过滤值再查
{ "measures": ["cbill_item.item_count", "cbill_item.total_amount"],
  "dimensions": ["cbill_item.item_name"],
  "timeDimensions": [{ "dimension": "cbill_item.created_date", "dateRange": ["2026-09-01", "2026-09-30"] }] }
```

可平移的对齐键：

| 主表查询用的维度 | 明细查询对应维度 | 说明 |
|---|---|---|
| bill_month | bill_month | 同从物理月表名提取，完全一致 |
| bill_date | created_date | 同源（各自表的 FDATE），dateRange 直接平移 |
| region_code / agency_code | region_code / agency_code | 同源冗余列，直接平移 |
| bill_type / state / bus_type / payer_name | — | 只在主表——按这些属性下钻必须走 2.1 的 join |

### 2.4 三种机制怎么选

| 场景 | 用哪种 |
|---|---|
| 按主表属性过滤/分组明细（单票、作废票等） | **2.1 belongs_to join**（一条查询） |
| Playground/BI 里点击单元格看明细 | **2.2 drill_members**（前端消费） |
| REST API / AI 代理顺序查询（data-qa-agent 6 步协议） | **2.3 两步查询**（无需任何额外声明） |

---

## 三、项目内的同类关系

同一模式（主表 cube + 明细表 cube + 双向 join 下钻）在本项目还会出现在：

| 主表 | 明细表 | 阶段 |
|---|---|---|
| cbill（UNE_CBILL） | cbill_item（UNE_CBILL_ITEM） | P0/P3 已完成 |
| stock_out（fbe_stock_out） | stock_out 的 _item | P4 |
| stock_in / stock_apply | 各自的 _item | P4 |

处理原则一致：**主子表各自建 cube、主表 count 用主键、明细粒度走明细 cube、
下钻用双向 join**（完整设计见 01-design.md"主子表处理原则"）。
