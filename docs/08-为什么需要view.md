# 为什么需要 view

> 用途：说明 view（交付面）的存在意义——不是 cube 的复制，是"消费契约"。
> 关联：[01-design.md](./01-design.md) §9

---

## cube 和 view 的区别

**cube 是原料面、是数据语义，view 是交付面、是消费契约**——差异不止"原料 vs
交付"一层，每个层面都成对出现：

| 维度 | cube（原料面） | view（交付面） |
|---|---|---|
| 是什么 | 数据语义：定义数据怎么算 | 消费契约：定义消费方怎么查 |
| 谁来查 | 消费方不直接碰，只被 view 引用 | 前端/BI/REST/AI 统一从这里查 |
| 列 | 全量 member，含技术键/敏感字段 | 只 include 该看的，excludes 挡技术/敏感字段（§1） |
| 行 | access_policy 管行权限 + 脱敏 | 不动行权限，与 cube 叠加生效（§5） |
| 路径 | 声明 join 边，可能多条可达 | join_path 钉死从哪条边查（§2.2） |
| 归属 | 同名成员各有语义（state 四种含义） | 单一来源消除歧义，前缀恒等于 view 名（§3） |
| 口径 | 一表一口径，原子度量 | 一个 view 装多个 cube，多口径并存（§4） |
| 发现 | 原料不对外（19 个 cube） | viewGroups 分组 + meta.ai_context（§6） |
| 稳定性 | 随便改：预聚合、拆分、改键 | 不变：cube 改了 view 不变，消费方 API 不破（§总结） |

一句话：**cube 管"怎么算"，view 管"怎么查"**——把"能查什么、从哪条边查、
口径是什么"从隐式约定变成显式声明。

---

## 建 view 的意义

### 1. view 只给你该看的字段

cube 层放原料（原子聚合、合成主键、行级权限维度、技术外键），view 层做交付——
消费方只看到 include 的 member。这不是美学，是治理：技术主键（fid）、关联键
（agency_code）、敏感字段（payer_name）被 excludes 挡在 API 之外，暴露面最小化。
P5 实测：superv_view 挡掉 7 个技术/敏感成员，只留 12 个 member + 4 个下钻维度。

### 2. 一个 view，多个 cube

#### 2.1 view 把多个 cube 装进一个消费入口

outbound_view 一个 view 声明了 5 个事实（出库 + 出库明细 + 入库 + 申领 + 库存）
和单位维度，一条查询同时出 5 个指标（P5 实测）：

```yaml
cubes:
  - join_path: stock_out                  # 出库
  - join_path: stock_out.stock_out_item   # 出库明细
  - join_path: stock_in                   # 入库
  - join_path: stock_apply                # 申领
  - join_path: stock                      # 库存
  - join_path: stock_out.agency           # 单位下钻
```

```json
out_count 993 | in_count 413 | apply_count 201 | stock_count 678 | total_amount 213013.06
```

**view联通的前提：cube 之间声明了 join 边**

Cube 把每个 view 解析到它的根 cube（suspicious / paybook / cbill），
要求根 cube 之间有路径——三个互不关联的事实 cube 之间没有声明任何 join 边。
这是设计而非缺陷：硬连会产生传递多路径（chasm trap），结果不可预测。
所以解法是客户端分开查、各自渲染。

#### 2.2 固定 join 路径

同一条事实cube表到区划有两条 join 路径——直接关联（paybook→region）和经单位传递
（paybook→agency→region）。两个路径都存在时，Cube 走哪条？结果可能不可预测
（docs/05）。view 用 `join_path` 把"从哪条边可达"写成声明，消费方不用猜：

```yaml
cubes:
  - join_path: paybook            # 根 cube
  - join_path: paybook.agency     # 单位下钻，走这条边
  - join_path: paybook.region     # 区划下钻，走这条边
```

#### 2.3 可达性是声明出来的

suspicious 声明了 agency+region+bill_type 三条 join 边——superv_view 首版只
声明了 agency，查询 region_name 下钻时报错（P5 实测）：

```
ERROR: 'region_name' not found for path 'superv_view.region_name'
```

补一行 `join_path: suspicious.region` 才通。图里声明了什么边，view 才能连什么。

### 3. 用 view 查，不用猜字段在哪个 cube

#### 举例：state 的四种语义

`state` 在四个cube内有四种含义——

| cube | state 的含义 |
|---|---|
| paybook | 缴款状态：1 待缴款 / 2 作废 / 3 已缴款 |
| cbill | 票据状态：1 正常 / 2 作废 |
| stock_out | 变更状态复合码：61=870 / 2=104 / 4=14 / 1=4 |
| writeoff | 审验状态：1 未审验 / 2 已审验 |

没有 view 时，用户在 UI 上选了 "state"，前端要反查是哪个 cube 的——选错了就是
**静默错口径**：查出来数字对不上，但没有任何报错。前端要自己维护
"成员 → 属于哪个 cube"的映射表，每加一个 cube 改一次代码。

#### 有 view：确定来源、消除同名歧义

usage_view 的 state 只有 cbill 一个来源，歧义消失。前端只看 usage_view 一份
meta（26 个 member，全部 `usage_view.*`），拼查询无归属判断，前缀恒等于 view 名：

```json
{"measures":["usage_view.total_amount"],
 "dimensions":["usage_view.name", "usage_view.bill_type_name"]}
```

AI 问数同理：viewGroups → usage_view → `meta.ai_context`（"不含项目笔数用
receipt_count，含项目份数用 item_count"）——一个问题、一份 meta、口径即答案。

### 4. 一个 view，多个口径

含项目/不含项目两口径（cbill 去重 / cbill_item 不去重）分子分母在两个事实
cube——只有 multi-fact view 能把它们放在一起（usage_view），
业务过滤在 cube 度量级写一次所有视图复用。

### 5. 建 view 不用改权限

权限是二维空间：**view 管列（能选什么 member），cube 管行（能看哪些行）**。
view 定成员不需要也不应该动 cube 的行权限——列的暴露跟着消费契约走（view 的
includes/excludes），行的收窄跟着数据语义走（cube 的 access_policy）。不应该
动是因为行权限是数据事实（这行属于哪个区划），不随消费入口变化：同一个 cube
挂多少个 view，行规则只有一条；若 view 能改行权限，每个 view 都变成要权限
评审的安全变更，建 view 的成本就回去了。

两者在查询时**叠加生效**：查 view 时 cube 行级规则照常拼进 SQL
（docs/11-access-control.md）。实证就在 paybook_view——行级过滤用的
`region_code` 本身被 view excludes（消费方走 region_name），过滤成员不进
view，权限不因此失效。P5 建 view 后 access_policy 零改动，JWT 实测
110/1/1 与直查一致。

这正是 P2 选声明式 access_policy 的决定性因素。query_rewrite（程序化中间
方案，已删除）做不到这种正交：权限是代码，按查询里的 cube/view 名匹配生效，
每建一个 view 都要改一次代码、维护 view 名匹配集合——漏改一个 view 就是
权限绕过。声明式把权限钉在 cube 模型上，跟着 cube 走，不跟着消费方数量走：

| | 声明式 access_policy | query_rewrite（已删除） |
|---|---|---|
| 权限声明在 | cube 模型文件，保存即热重载 | conf/cube.py 代码 |
| 建 view 时 | 零改动 | 改代码 + 维护 view 名匹配集合 |
| 漏改一个 view | 权限照常叠加 | 权限绕过 |

（行级权限方案全记录：[03-行级权限记录.md](./03-行级权限记录.md)）

### 6. 找视图按分组找

meta.ai_context（口径即文档）+ viewGroups 分组（fiscal_payment / ticket_mgmt）
——AI 代理按分组发现视图，不用扫 19 个 cube。

---

## 如何判断要建一个 view

| # | 判断点 | 反例（不建） |
|---|---|---|
| 1 | 有消费方吗？ | 没有交付需求的原料不建（P4.5 的 BILLSUMMARY/RECORD/RESULT 暂缓） |
| 2 | 按业务口径划分，不是每个 cube 配一个 | 6 个 view 覆盖全部消费口径 |
| 3 | 需要路径治理吗？ | 单 cube 无多条 join 边、无交付需求的不建 |
| 4 | member 对外有价值吗？ | 技术主键/外键/敏感字段不进 view |
| 5 | 有口径要并存吗？ | 没有 → 单事实更简单 |

命名注意：view 名 + 成员名受 11g 30 字符约束——
`ticket_supervision_overview` 落成 `superv_view`。

---

## 一句话总结

**view 不是 cube 的复制，是消费契约**：
cube 改了（预聚合、拆分），view 不变，消费方 API 不破；
cube 藏了（技术主键、敏感字段），view 用 excludes 挡在 API 之外，暴露面最小化。
