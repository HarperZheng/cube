# Pre-aggregations（预聚合）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/pre-aggregations

## 是什么

Pre-aggregation 是数据的**物化汇总**，通过预先计算结果来加速查询。至少需要 `name` 和 `type`。预聚合必须包含将要查询的所有维度和度量；通常放在包含其大部分成员的 cube 里（若不包含任何该 cube 的成员则被忽略）。

## 基本结构

```yaml
pre_aggregations:
  - name: orders_by_status        # 与 cube 名一起作为预聚合表名前缀
    measures:
      - CUBE.count
    dimensions:
      - CUBE.status
    time_dimension: CUBE.created_at   # 可选：时间维度
    granularity: day                  # 使用 time_dimension 时必填
```

## 类型（type）

| 类型 | 说明 |
|---|---|
| `rollup`（默认） | 最有效的加速方式：按选定维度分组的汇总数据。加和型 measure（`count`/`sum`/`min`/`max`/`count_distinct_approx`）构成的 rollup 最快，可覆盖其子集查询 |
| `original_sql` | 物化 cube 的 sql 结果，仅在 sql 是复杂查询（嵌套子查询/窗口函数/多 join）时使用；只能存数据源（不要 external） |
| `rollup_join` | 跨数据源 join 两个 rollup（Preview）；同数据源直接在 rollup 中列出其他 cube 的成员即可 |
| `rollup_lambda` | 组合数据源数据与多个 rollup，适合实时数据场景；必须定义在 cube 的其他预聚合之前 |

## rollup 详解：物化了什么、"成员 ⊆ rollup"规则（本项目实例，实测 2026-09-23）

> 实测背景见 [06-解释预聚合.md](./06-解释预聚合.md)、[06-解释cubestore.md](./06-解释cubestore.md)。

### rollup 物化的是"预计算的 GROUP BY 结果"

以本项目 `cbill_main` 为例，它物化的就是这条 SQL 的结果：

```sql
SELECT state, bus_type, is_income, region_code, bill_type__name, bill_month,
       COUNT(*) count, COUNT(DISTINCT fid) receipt_count, SUM(ftotalamt) total_amount,
       ...  -- （11 个度量）
FROM (45 张月表 UNION ALL)
GROUP BY state, bus_type, is_income, region_code, bill_type__name, bill_month
```

这个 GROUP BY 结果被存成 parquet（每分区单文件仅 5-8KB，聚合后只剩几十~几百行）。

### "成员 ⊆ rollup"规则：查询要的每一列（含过滤列）都必须在预聚合里

预聚合的成员清单 = **物理上存在的列的集合**。parquet 文件里只有这些列：

```
度量列 ×11 + 维度列 ×5 + 时间列 bill_month
```

三层含义：

1. **列必须物理存在**：查 `total_amount by bill_date` 不命中——parquet 里没有
   bill_date 这一列，Cube Store 拿不出，只能回源库
2. **子集命中（rollup 名字的由来）**：存的是最细粒度（声明的全部维度组合），
   查询用更少维度 = Cube Store 在已存行上**再聚合一次**（向上卷起，从细粒度
   卷到粗粒度）。再聚合只对加和型 measure 数学上成立——**countDistinct 不能
   从分组结果再聚合**（两个组的去重数相加 ≠ 总去重数）
3. **filter member 也要在**：filter 会变成对预聚合列的 WHERE，列不在就没法
   在 Cube Store 里过滤

### 实例对照（全部实测，cube.js query 自报命中状态）

| 查询 | 成员检查 | 结果 |
|---|---|---|
| `count by state` | count ✓ + state ✓ | ✅ 命中 |
| `total_amount by bill_month` | total_amount ✓ + bill_month ✓ | ✅ 命中 |
| `dateRange 时间边界` | 只扫范围内分区（分区剪枝） | ✅ 命中（构建完成后） |
| `total_amount by bill_date` | bill_date ✗ 不在清单 | ❌ 不命中 |
| `YTD`（rolling window 宏度量） | amt_year_to_date ✗ 不在清单 | ❌ 不命中 |
| `cbill.bill_no 过滤单票` | filter member bill_no ✗ | ❌ 不命中 |
| `bill_type.name 维度` | 在清单但实测不命中（countDistinct × join 维度匹配约束） | ❌ 不命中（raw 兜底） |

一句话：**rollup 定义 = 预先算好并存储的"列的清单"；成员 ⊆ rollup = 查询要的
每一列（含过滤列）都在这份清单里，Cube Store 才有能力只用自己的数据回答——
缺任何一列就回源库现算。**

## 刷新控制

- **`refresh_key`**：默认 `every: 1 hour`；可自定义 `sql`（如 `SELECT MAX(created_at) FROM orders`，值变化才刷新）、`every`（间隔或 CRON）。分区预聚合按分区分别评估。
- **`incremental: true`** + **`update_window`**（如 `7 day`）：增量刷新分区，只刷新 update_window 内的分区。增量模式下不能再用 `refresh_key.sql`。
- **`build_range_start` / `build_range_end`**：定义调度刷新构建的分区范围（SQL 表达式，如 `SELECT CURRENT_DATE - INTERVAL '300 day'`）。无 partition_granularity 时无效。范围外数据不会被返回。
- **`scheduled_refresh`**：默认 `true` 自动保持最新；`false` 则需外部编排触发，且可能被清理回收。

## 其他参数

- **`partition_granularity`**（`hour`/`day`/`week`/`month`/`quarter`/`year`）：分区粒度。分区数 = build_range ÷ partition_granularity；建议单个预聚合总分区数控制在 500–1000 以内，太多会 OOM。
- **`segments`**：可命中该预聚合的分段列表。
- **`allow_non_strict_date_range_match`**：放宽日期范围匹配（BI 工具常用），默认 true。
- **`use_original_sql_pre_aggregations: true`**：在 rollup 中复用 original_sql 预聚合，避免每次重建 rollup 都重跑重型 SQL。
- **`union_with_source_data: true`**（rollup_lambda 类型）：预聚合与源库最新数据 UNION，牺牲延迟换准确性。
- **`indexes`**：为高基数预聚合定义索引；`type: aggregate` 为聚合索引（只有加和型 measure 且查询的维度/过滤都在 columns 内才能命中）。

## 注意事项

- rollup 定义可以包含**多个 cube** 的成员（同数据源），join 按标准规则构建。
- 跨数据源需用 `rollup_join`；被引用的 rollup 需要有以 join key 开头的索引。
- `rollup_join` 是临时的，不要设 `scheduled_refresh`。
