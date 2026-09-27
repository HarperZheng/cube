# Cube（立方体）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/cube

## 是什么

Cube 表示数据库中的一张数据表，是数据建模的基本单元。每个 Cube 内包含：**measures（度量）、dimensions（维度）、hierarchies（层级）、segments（分段）、joins（连接）、pre_aggregations（预聚合）、access_policy（访问策略）**。

通常一个文件声明一个 Cube。

## 基本结构（YAML）

```yaml
cubes:
  - name: users          # Cube 名称，全局唯一
    sql_table: users     # 直接指定表名（推荐）
    # sql: SELECT * FROM users   # 或指定 SQL 查询（不能带 GROUP BY）

    joins:
      - name: organizations
        relationship: many_to_one
        sql: "{CUBE.organization_id} = {organizations.id}"

    measures:
      - name: count
        type: count
        sql: id

    dimensions:
      - name: organization_id
        sql: organization_id
        type: number
        primary_key: true
      - name: created_at
        sql: created_at
        type: time
      - name: country
        sql: country
        type: string
```

## 主要参数

| 参数 | 说明 |
|---|---|
| `name` | 标识符，在所有 cube 和 view 中唯一 |
| `sql_table` | 直接指定底层表名，等价于 `SELECT * FROM table`，**优先使用** |
| `sql` | 任意合法 SQL 查询，必须返回平表（无聚合、无 GROUP BY）；可用 `{users.sql()}` 复用其他 cube 的 SQL |
| `sql_alias` | 自定义别名前缀（cube 名过长被数据库截断时用），生成成员别名如 `order_facts__count` |
| `extends` | 继承另一个 cube 的全部声明成员，用于代码复用 |
| `data_source` | 数据源名称，支持多数据库场景，默认 `default` |
| `title` | 显示名称（默认自动 humanize） |
| `description` | 人类可读描述，展示在 Playground 和 API 中 |
| `public` | 是否可被 API 查询，默认 `true` |
| `refresh_key` | 缓存刷新键：默认 `every: '2 minute'`（BigQuery/Athena/Snowflake 等）或 `'10 second'`（其他）；可自定义 `sql`（如 `SELECT MAX(updated_at) FROM orders`）、`every`（间隔或 CRON + `timezone`） |
| `meta` | 自定义元数据传给前端；`meta.ai_context` 可给 AI 提供上下文而不暴露在 UI |
| `calendar` | 设为 `true` 表示日历 cube，允许在其时间维度上覆写 time-shift 和 granularity（用于自定义日历） |
| `pre_aggregations` / `joins` / `dimensions` / `hierarchies` / `segments` / `measures` / `access_policy` | 各子配置块 |

## 注意事项

- `sql` 中的查询不要写 GROUP BY，应返回明细平表，聚合由 measure 定义。
- CRON 表达式只支持等长时间间隔，不支持"每月几号"这类字段。
- `extends` 在 JS 中可配合"匿名 cube"（不注册全局）做动态建模。
