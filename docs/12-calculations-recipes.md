# 计算与指标（Calculations & Metrics）常用用法

> 参考文档：https://docs.cube.dev/recipes/data-modeling 下的 percentiles、filtered-aggregates、average-order-value、period-over-period、reusable-period-to-date

## 总览表

| 用法 | 解决什么问题 | 核心手段 | 关键点 |
|------|-------------|---------|--------|
| [百分位数（percentiles）](#1-百分位数percentiles) | 平均数在偏态分布下会失真，需要看分布 | `PERCENTILE_CONT` 等数据库函数 + `type: number` | 中位数就是 0.5 分位；BigQuery 用 `APPROX_QUANTILES` |
| [过滤聚合（filtered aggregates）](#2-过滤聚合filtered-aggregates) | 聚合 A 实体的事实，但要按 B 实体的维度/时间过滤 | 度量上直接加 `filters`，可引用其他 cube 的成员 | 沿 join 路径"度量向上传、维度向下传" |
| [客单价 AOV](#3-客单价average-order-value) | 收入 ÷ 订单数这类"两个聚合的比值" | 计算度量：`{revenue} / NULLIF({count}, 0)` | 必须在聚合之后相除，不能在行级别算；分子分母不在同一张表时用多事实视图（Tesseract） |
| [同比环比（period-over-period）](#4-同比环比period-over-period) | 算周环比/月环比等增长 | 多阶段度量（`multi_stage: true`）+ `time_shift` | 查询时时间维度粒度要和周期一致（如月环比用 month） |
| [复用 period-to-date 逻辑](#5-复用-period-to-date-逻辑) | WTD/MTD/QTD/YTD 组合爆炸（100 个指标 × 4 周期 = 400 个定义） | Jinja 宏批量生成 `rolling_window: {type: to_date}` 度量 | 逻辑写一次，宏里加一个周期就能全局生效；编译期生成，不减少成员数，只减少源码重复 |

---

## 1. 百分位数（percentiles）

**问题**：平均数容易被极端值带偏。`(1,2,3,4)` 和 `(0,0,0,10)` 的平均值都是 2.5，但中位数分别是 2.5 和 0——后者更真实。

**做法**：平均数用内置 `type: avg`；百分位数没有内置类型，用数据库原生函数，度量类型写 `number`：

```yaml
measures:
  - name: avg_age
    type: avg
    sql: age

  - name: median_age          # 中位数 = 0.5 分位
    type: number
    sql: PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY age)

  - name: p95_age             # 95 分位：95% 的用户小于该值
    type: number
    sql: PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY age)
```

- Postgres / Snowflake：`PERCENTILE_CONT` / `PERCENTILE_DISC`
- BigQuery：`APPROX_QUANTILES`

## 2. 过滤聚合（filtered aggregates）

**问题**：比如算"每个零售商自目标起始日之后的总销售额"——事实在 sales 表，但过滤条件（goal_start）在 retailer 表，跨 cube 过滤。

**做法**：在度量上加 `filters`，filter 里可以引用其他 cube 的成员（沿 join 路径传过来）：

```yaml
# sales cube
measures:
  - name: total_sales_for_goal
    sql: "{CUBE}.sales"
    type: sum
    filters:
      - sql: "{CUBE.order_date} >= {CUBE.goal_start}"   # goal_start 来自 retailer
```

数据流向（沿 join 路径 retailer → store → sales）：
- **度量向上传**：sales 的聚合通过 subquery 维度一层层传给 store、retailer
- **维度向下传**：retailer 的 goal_start 一层层传给 sales，供 filter 使用

这套"度量上行、维度下行"的模式能解决很多跨 cube 建模问题。

## 3. 客单价（average order value）

**问题**：AOV = 收入 ÷ 订单数。看似一行公式，但它是**两个聚合的比值**，必须等各自聚合完再相除，不能写成行级别的 `amount / orders`。

**情况一：分子分母在同一个 cube** —— 直接写计算度量：

```yaml
measures:
  - name: revenue
    sql: amount
    type: sum

  - name: count
    type: count

  - name: average_order_value
    sql: "{revenue} / NULLIF({count}, 0)"   # NULLIF 防止除零，无订单返回 NULL
    type: number
```

**情况二：分子分母在两张事实表**（零售常见：销售额按 天×商品×门店 预聚合，交易数按明细行计数）——两张表不直接 join，通过共享的 items/locations/dates 维度汇合，需要**多事实视图（multi-fact view）**，由 Tesseract 引擎支持（v1.7.0+ 默认开启）：

1. 各自的度量定义在各自的 cube 上，业务过滤逻辑（如排除退货）用**度量级 filters** 写一次，所有视图复用
2. AOV 定义在 view 层，把两个 cube 的度量组合起来

## 4. 同比环比（period-over-period）

**问题**：算月环比、周环比等增长。

**做法**：三步——基础度量 → time_shift 度量 → 计算度量：

```yaml
measures:
  - name: current_month_sum        # ① 当前周期
    sql: value
    type: sum

  - name: previous_month_sum       # ② 平移到上一周期
    multi_stage: true
    sql: "{current_month_sum}"
    type: number
    time_shift:
      - interval: 1 month
        type: prior

  - name: month_over_month_ratio   # ③ 相除
    multi_stage: true
    sql: "{current_month_sum} / NULLIF({previous_month_sum}, 0)"
    type: number
```

- 多阶段计算需要 Tesseract（v1.7.0+）
- 查询时时间维度的粒度要和周期匹配：月环比就按 `month` 粒度分组
- 此方案是固定的固定周期；要让用户查询时自选周期，见 [13 号文档：查询期参数](13-query-time-parameters.md)

### time_shift 参数说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/measures（time_shift 一节）

`time_shift` 是度量级参数，接受一个**配置数组**，每项由 `time_dimension`、`type`、`interval`、`name` 组成。使用 time_shift 的度量必须同时声明 `multi_stage: true`。

| 参数 | 必填 | 说明 |
|------|------|------|
| `type` | 是 | 平移方向：`prior`（向前/过去）或 `next`（向后/未来） |
| `interval` | 是 | 平移大小，格式为"数量 单位"，如 `1 year`、`7 days`、`3 months` |
| `time_dimension` | 否 | 指定作用于哪个时间维度。**省略时**：对查询中所有时间维度生效，且 `time_shift` 数组只允许一条配置；**指定时**：只有查询包含该时间维度才生效——适合对不同时间维度施加不同平移 |
| `name` | 否 | 引用日历 cube（`calendar: true`）的时间维度上定义的**命名平移**。适合多个度量共用同一配置（如 prior + 1 year）、但需按自定义日历以不同方式平移的场景 |

**示例**：

```yaml
measures:
  - name: revenue_7d_ago        # 固定平移：7 天前
    multi_stage: true
    sql: "{revenue}"
    type: number
    time_shift:
      - interval: 7 days
        type: prior

  - name: lagging_revenue       # 不同时间维度不同平移
    multi_stage: true
    sql: "{revenue}"
    type: number
    time_shift:
      - time_dimension: purchase_date
        interval: 3 months
        type: prior
      - time_dimension: shipping_date
        interval: 2 months
        type: prior
      - time_dimension: delivery_date
        interval: 1 month
        type: prior
```

**命名平移（配合日历 cube）**：日历 cube 的时间维度上用 `time_shift` + `sql` 定义映射，度量侧用 `name` 引用：

```yaml
# 日历 cube：date → 昨年同期的映射日期
- name: sales_calendar
  calendar: true
  dimensions:
    - name: date
      sql: "{CUBE}.date::TIMESTAMP"
      type: time
      time_shift:
        - name: 1_year_prior
          sql: "{CUBE}.mapped_date::TIMESTAMP"

# 度量侧：按名字引用，平移量由日历 cube 决定
measures:
  - name: revenue_prior_year
    multi_stage: true
    sql: "{revenue}"
    type: number
    time_shift:
      - name: 1_year_prior
```

## 5. 复用 period-to-date 逻辑

**问题**：WTD/MTD/QTD/YTD 每个指标都要配 4 个变体，100 个指标就是 400 个度量定义，加一个周期要改所有 cube。

**做法**：period-to-date 本身是内置的 rolling window：

```yaml
measures:
  - name: revenue_year_to_date
    sql: amount
    type: sum
    rolling_window:
      type: to_date
      granularity: year
```

把这段"形状"提取成 Jinja 宏（放在 `model/macros/` 下）：

```jinja
{%- macro to_date_measures(name, sql='', type='sum', periods=['week', 'month', 'quarter', 'year']) -%}
{%- for period in periods %}
      - name: {{ name | safe }}_{{ period | safe }}_to_date
        {% if sql %}sql: |-
          {{ sql | indent(10) | safe }}
        {% endif %}type: {{ type | safe }}
        rolling_window:
          type: to_date
          granularity: {{ period | safe }}
{% endfor -%}
{%- endmacro -%}
```

在 cube 里按基础度量各调用一次：

```yaml
measures:
  - name: revenue
    sql: amount
    type: sum
  - name: count
    type: count
{{ ptd.to_date_measures("revenue", "amount") }}
{{ ptd.to_date_measures("count", type="count") }}     # count 不传 sql，保持 COUNT(*)
```

两次调用生成 8 个度量（revenue/count 各 4 个周期）。加一个周期 = 改宏默认列表一处。

**注意**：
- 宏在**编译期**生成度量——模型里成员数不变，省掉的是源码里的重复
- `periods` 参数可以只传需要的子集，避免生成没人用的成员
- 按 to_date 窗口自身的粒度分组时，窗口值会等于基础度量本身（如按月分组看 MTD 就只是当月收入）；要看到累加效果，请按更细的粒度分组
- 财政/零售日历：用日历 cube 重定义 week/month/quarter/year 的含义，宏不用改，`periods` 只传日历 cube 实际重定义的粒度（日历 cube 场景需要 Tesseract；自定义粒度需 v1.7.32+）
