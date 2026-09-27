# 维度下钻（Drilldowns）

> 参考文档：
> - https://docs.cube.dev/reference/data-modeling/measures#drill_members
> - https://docs.cube.dev/recipes/core-data-api/drilldowns
> - https://docs.cube.dev/reference/javascript-sdk/reference/cubejs-client-core#drilldown

## 是什么

下钻（Drilldown）用于构建"了解更多明细"的交互：用户在聚合图表/表格里点某个数据点，查看**贡献到这个聚合值的底层明细行**。典型场景：点击"本月销售额"柱子，弹出这笔销售额对应的订单明细表。

实现分两层：

1. **建模层**：在度量（measure）上用 `drill_members` 声明"下钻到该指标时展示哪些字段"。
2. **查询层**：前端拿到聚合结果后调用 `ResultSet.drillDown()`，生成一个带好过滤条件的明细查询，再用普通查询执行。

## 建模层：`drill_members`

`drill_members` 定义在**度量级别**，是一个维度数组。定义后，下钻该度量时**始终**用这些字段展示底层数据。

- 数组里可直接引用本 cube 的维度名，也可用 `其他cube.维度` 引用已 join 的 cube 的维度（Cube 会自动把本 cube 维度名和关联 cube 名注入上下文）。
- 只能引用**维度**（dimensions），不能放其他度量以外的度量。

```yaml
cubes:
  - name: orders
    sql_table: orders

    joins:
      - name: users
        relationship: many_to_one
        sql: "{CUBE}.user_id = {users.id}"

      - name: products
        relationship: many_to_one
        sql: "{CUBE}.product_id = {products.id}"

    measures:
      - name: count
        type: count
        # 前端下钻 count 时可能想看的所有属性
        drill_members:
          - id
          - status
          - products.name
          - users.city

      - name: revenue
        type: sum
        sql: price
        drill_members:
          - id
          - price          # 度量对应的原始数值字段也可以放进来
          - status
          - products.name
          - products.id

    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true
        public: true

      - name: status
        sql: status
        type: string
```

JavaScript 语法定义在 `measures` 对象里：`drill_members: [id, status, products.name, users.city]`（旧写法 `drillMembers` 等价）。

## 查询层：`ResultSet.drillDown()`

```js
drillDown(drillDownLocator, pivotConfig?)
```

`drillDown` **不发起请求**，它基于已有的聚合结果 `ResultSet` 返回一个新的查询对象（Query）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `drillDownLocator` | `{ xValues: string[], yValues?: string[] }` | 要下钻的数据点坐标——即聚合结果中该单元格的 x/y 值，Cube 据此反推出对应的过滤条件 |
| `pivotConfig` | 可选 | 如果聚合查询用过 pivotConfig 做轴变换，这里要传同一个 |

返回的查询自动填好 `measures`（来自 `drill_members`）、`dimensions`、`filters`（按点击的数据点生成维度/度量过滤）、`timeDimensions`：

```js
{
  measures: ['Orders.count'],
  dimensions: ['Orders.status', 'Users.city'],
  filters: [
    // 根据点击的数据点自动生成的过滤条件
  ],
  timeDimensions: [
    // ...
  ]
}
```

拿到查询后，可以随意补充 `limit`、`order` 再执行（React 示例）：

```js
const { resultSet } = useCubeQuery(query);          // 原始聚合查询
const drillDownQuery = resultSet?.drillDown({ xValues, yValues }, pivotConfig);

// 用生成的明细查询拉取明细行
const drillDownResponse = useCubeQuery(
  {
    ...drillDownQuery,
    limit: 30,
    order: { 'Orders.ts': 'desc' }
  },
  { skip: !drillDownQuery }
);
```

也可以绕过 SDK，直接对 `/cubejs-api/v1/load` 发 POST：`drillDown()` 返回的 Query 就是该接口的请求体格式。

## 工作原理小结

1. 前端执行聚合查询（按天/按城市等分组的 count、sum 等）。
2. 用户点击某个数据点 → 前端把该点的 `xValues`/`yValues` 传给 `drillDown()`。
3. `drillDown()` 生成明细查询：**度量的 `drill_members` 作为展示列**，点击点的值转化为**过滤条件**（等值过滤 + 原查询的时间/过滤条件继承），因此明细行恰好就是"贡献到这个聚合值的行"。
4. 明细查询作为普通查询执行，前端渲染明细表/弹窗。

## 功能小结（本地实例已验证）

`drill_members` 声明后，功能在三个层面体现（本项目 66 个度量实测）：

| 层面 | 体现 | 验证结果 |
|---|---|---|
| meta 接口 | 声明的度量在 `/cubejs-api/v1/meta` 响应里带 `drillMembers` + `drillMembersGrouped` 字段 | `cbill.receipt_count` → `['cbill.bill_no', 'cbill_item.item_name', 'cbill_item.item_code']`；未声明的度量（如 `cbill.count`、`total_amount`）返回**空数组**，前端据此不展示下钻入口 |
| 查询接口 | `/cubejs-api/v1/load` 响应的 `annotation.measures[x]` 同样带 `drillMembers`——前端 `drillDown()` 内部就是判断它是否非空 | annotation keys 含 `drillMembers`/`drillMembersGrouped`，值与 meta 一致 |
| 查询生成 | 点击数据点后，`drillDown()` 把 drill_members 变成展示列、点击值 + 原时间范围变成过滤条件，生成"恰好贡献到该聚合值"的明细查询 | 2025-01 开票记录数 464 → 下钻返回该月 464 行明细（bill_no / item_name / item_code，每行 receipt_count=1） |

未声明 `drill_members` 的度量：meta/annotation 返回空数组 → `drillDown()` 返回 `null` → 前端不出下钻入口。**不声明 = 功能关闭，声明即开关。**

## 踩坑：Playground 里看不到 "Drill down" 选项

本项目镜像（cube 1.7.42）的 Playground（`#/build`）**点击数据点不会出现 "Drill down" 菜单**——这是 UI 限制，不是配置问题：

- 后端数据层正常：meta 和 `/cubejs-api/v1/load` 响应的 `annotation.measures[x].drillMembers` 都带下钻字段，`drillDown()` 能返回有效查询。
- 但前端 bundle 里根本不存在 "Drill down" 菜单文案；`onQueryDrilldown` 回调只有定义没有调用方；`DrilldownModal` 仅被 Vizard 预览模板（自建前端代码模板）引用。
- 结论：1.7.x 的下钻是**客户端 SDK 能力，需在自己前端实现**（meta 暴露入口 + `drillDown()` 生成查询），内置 Playground 未接线。

## 实践要点

- `drill_members` 按"用户下钻时想看到什么"来选：通常含主键/ID（用于关联跳转）、状态类维度、以及度量对应的原始数值字段（如 `price` 之于 `sum(price)`）。
- 一个度量只有一组 `drill_members`；不同度量可定义不同组。如果希望下钻列可切换，需要前端配合 meta 信息做多个度量或自行拼查询。
- 跨 cube 字段必须在度量所在 cube 上已声明 join，否则编译报错。
- 明细查询走的是普通查询链路，同样受益于预聚合之外的常规 SQL 执行；明细行数可能很大，务必在前端补 `limit`/分页。
