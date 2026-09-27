# Measures（度量）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/measures

## 是什么

Measure 是对数据库表列的**聚合计算**（如 count、sum、avg、滚动窗口等）。每个 measure 必须有 `name`、`sql`、`type` 三个参数。

## 基本结构

```yaml
measures:
  - name: count                # 标识符，在 cube 内所有成员中唯一
    sql: id                    # 聚合的列或表达式
    type: count                # 聚合类型
  - name: total_amount
    sql: amount
    type: sum
```

## 类型（type）

| 类型 | sql 要求 | 说明 |
|---|---|---|
| `count` | 可省略 | 计数，正确处理 join 行倍增 |
| `count_distinct` | 非聚合表达式 | 去重计数，类似 `COUNT(DISTINCT …)` |
| `count_distinct_approx` | 非聚合表达式 | HyperLogLog 近似去重计数，**可加和**，能用于 rollup 预聚合 |
| `sum` / `avg` / `min` / `max` | 非聚合数值表达式 | Cube 会按类型自动包上聚合函数 |
| `number` | 聚合表达式 | 对其他 measure 做算术（**计算度量**用），如 `{purchases} / {orders_count}` |
| `number_agg` | 自定义聚合函数 | 自定义聚合（如 `PERCENTILE_CONT`），仅 Tesseract 引擎 |
| `string` / `time` / `boolean` | 返回对应类型的聚合表达式 | 字符串/时间戳/布尔值度量 |

## 常用参数

- `title` / `description`：显示名和描述。
- `public: false`：该 measure 不可通过 API 查询。
- `format`：显示格式，如 `number`、`percent`、`currency`、`abbr`（K/M/G）、`accounting`（负数括号），可加 `_N` 后缀控制小数位（如 `percent_1`），也可直接传 d3-format 字符串如 `"$,.2f"`。
- `currency`：ISO 4217 币种（`USD`/`EUR` 等），仅数值型 measure 可用。
- `filters`：度量级过滤条件，如 `filters: [{ sql: "{CUBE}.status = 'completed'" }]`，用于"完成订单数"这类口径。
- `mask`：被数据脱敏策略命中时的替换值（静态值或聚合 SQL 表达式），默认 NULL。
- `drill_members`：下钻字段列表（一组维度，可含 join cube 的维度，如 `products.name`）。

## 多阶段度量（multi_stage）

引用其他 measure 的二次计算需加 `multi_stage: true`，表达式先对每个引用的度量单独聚合后再做外层计算：

```yaml
measures:
  - name: purchases_ratio
    sql: "1.0 * {purchases} / {orders_count}"
    type: number
    multi_stage: true
    format: percent
```

配套参数：

- **`rolling_window`**：滚动窗口计算。`trailing`/`leading` 定义窗口大小（如 `1 month`、`unbounded` 累计），`offset: start|end` 定义锚点；`type: to_date` + `granularity: year` 表示年初至今（YTD）。旧写法 `month_to_date` 等已废弃。
- **`grain`**：控制内层聚合的 GROUP BY 粒度。`keep_only`（只按指定维度分组，用于占比）、`exclude`（排除指定维度，用于组内排名）、`include`（追加维度，用于嵌套聚合）。`keep_only` 与 `exclude` 互斥。grain 只作用于声明它的度量，**不会把追加的维度暴露给建在它之上的度量**；组合多个共享粒度的多阶段度量时，`grain` 要声明在组合度量上。
- **`filter`**：覆写内层聚合阶段继承的过滤上下文，用于"share of total"等分母忽略查询过滤的场景。四个 key 可组合：
  - `exclude`：列出的成员（维度或分段）的查询过滤在内层阶段被丢弃
  - `keep_only`：只保留列出成员的过滤，其余继承的过滤全部丢弃
  - `include`：向内层阶段注入额外谓词，格式同查询过滤（member/operator/values），可嵌套 and/or 组
  - `mode`：覆写在多阶段链上如何组合——`relative`（默认，相对继承的过滤上下文应用）或 `fixed`（忽略上游多阶段度量继承的过滤，作为绝对过滤上下文）。顶层（不在链上）两者等价
- **`time_shift`**：时间位移，`type: prior|next` + `interval: 1 year`；可指定 `time_dimension`，或引用日历 cube 上命名的位移（`name`）。必须配合 `multi_stage: true`。
- **`case`**：条件度量，基于 `switch` 维度的值分发到不同度量（需 Tesseract 引擎，`multi_stage: true`，必须写 `else` 分支）。

## 旧参数：group_by / reduce_by / add_group_by（legacy）

这三个参数是控制多阶段度量内层 GROUP BY 的**原始写法**，**仍然被支持**，但 `grain` 已完全覆盖三者，新数据模型应使用 `grain`。

| 旧参数 | grain 等价写法 | 对内层 GROUP BY 的影响 |
|---|---|---|
| `group_by` | `grain.keep_only` | 只按列出的维度分组，忽略查询维度 |
| `reduce_by` | `grain.exclude` | 查询维度减去列出的维度 |
| `add_group_by` | `grain.include` | 查询维度加上列出的维度 |

三者都接受同 cube 的维度名列表。迁移方向：`group_by` → `grain.keep_only`、`reduce_by` → `grain.exclude`、`add_group_by` → `grain.include`。
