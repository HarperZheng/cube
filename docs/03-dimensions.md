# Dimensions（维度）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/dimensions

## 是什么

Dimension 是与度量相关的**属性**（如 country、age、occupation），用于分组、过滤和下钻。每个维度必须有 `name`、`sql`、`type`。

## 基本结构

```yaml
dimensions:
  - name: country
    sql: country
    type: string
  - name: created_at
    sql: created_at
    type: time
  - name: id
    sql: id
    type: number
    primary_key: true
```

## 类型（type）

| 类型 | 说明 |
|---|---|
| `time` | 时间戳列，用于时间序列；目标列应为 TIMESTAMP，其他类型需在 sql 中 cast |
| `string` | 文本字段 |
| `number` | 数值/整数字段 |
| `boolean` | 布尔字段 |
| `switch` | 枚举型，只有 `values` 子参数（无 sql），用于 `case` 度量（仅 Tesseract） |
| `geo` | 地理坐标，用 `latitude` + `longitude` 子参数代替 sql |

## 常用参数

- **`primary_key: true`**：主键维度，**join 正常工作的必要条件**（Cube 依赖主键解决 chasm/fan trap 行倍增）。可多个主键组成复合键。注意：设 `primary_key: true` 会把 `public` 默认值改为 `false`。
- `title` / `description` / `public`：显示名、描述、API 可见性。
- `format`：显示格式。string 类型支持 `imageUrl`、`link`（可带 `label` 对象形式）；number 类型同 measure（`number`/`percent`/`currency`/`abbr`/`accounting`/`id`）；time 类型用 strftime 格式串（如 `%Y-%m-%d %H:%M:%S`）。
- `currency`：币种（仅 number 类型）。
- `order: asc|desc`：维度默认排序，暴露给 API/BI 工具。
- `meta`：自定义元数据；`meta.ai_context` 给 AI 上下文。
- `mask`：脱敏替换值（静态值或 SQL 表达式）。
- `links`：为维度定义外部链接（`url` SQL 表达式或 `dashboard` 引用 + `params`，可选 `icon`/`target`/`primary: true`）。每个链接会生成一个合成维度。
- `sub_query: true`：子查询维度，在维度中引用其他 cube 的度量（如 `{users.count}`），高级用法；可配合 `propagate_filters_to_sub_query: true` 把查询过滤传入子查询。
- `case`：基于 SQL 条件定义维度，`when`（sql + label）+ `else`，如把 size_value 映射为 xl/xxl/Unknown。

## 时间维度的 granularities（自定义时间粒度）

默认粒度：`year`、`quarter`、`month`、`week`（周一起始）、`day`、`hour`、`minute`、`second`。

```yaml
dimensions:
  - name: time
    sql: time
    type: time
    granularities:
      - name: quarter_hour          # 自定义粒度
        interval: 15 minutes
      - name: fiscal_year_starting_on_april_01
        interval: 1 year
        origin: "2025-04-01"        # 或用 offset 偏移
```

- `interval` 格式：`quantity unit [quantity unit...]`，如 `5 days`、`1 year 6 months`。
- 在**日历 cube**（`calendar: true`）中可用 `sql` 覆写默认粒度名（month/quarter/year 等），映射到预计算列，用于财年日历。
- 时间维度还可定义 `time_shift`（命名时间位移，供其他 cube 的 time_shift 度量引用，支持自定义日历映射）。
