# Views（视图）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/view

## 是什么

View 是 cube 成员的**精选组合**，位于 cube 数据图之上，为下游消费方（BI 工具、API、AI 代理）提供统一门面。用途：定义指标、治理与数据访问管理、消除歧义的 join 路径。每个 view 必须有 `name` 和 `cubes`。

## 基本结构

```yaml
views:
  - name: orders
    cubes:
      - join_path: base_orders                 # 根 cube 直接写名字
        includes:
          - status
          - created_date
          - total_amount
          - count
      - join_path: base_orders.users           # 点号表示法描述 join 路径
        prefix: true                           # 成员名加 cube 前缀（users_city）
        includes: "*"
        excludes:
          - company
```

## cubes 块参数

- **`join_path`**：点号表示法（`cube_1.cube_2.cube_3`）描述该视图使用的 join 路径；根 cube 直接写名字。
- **`includes`**：要纳入视图的成员（measures、dimensions、hierarchies、segments）；`"*"` 表示全部。
- **`excludes`**：配合 `"*"` 排除成员。注意：view 定义自己的暴露面，included 成员**不继承** cube 上的 `public: false` —— 需用 excludes 排除。
- **`prefix: true`**：成员名加 cube 名前缀；`alias` 可自定义前缀。
- 单个成员可用 `alias` / `title` / `description` / `format` / `meta` 覆写。

## 视图级成员定义

- **`measures` / `dimensions`**：在 view 上定义派生成员，`sql` **只能引用视图已 include 的成员**（用 `{CUBE.member}`），不能引用表列——引用了表列会编译报错，应移到 cube 定义。跨 cube 组合成员的度量加 `multi_stage: true`：

```yaml
views:
  - name: orders_overview
    cubes:
      - join_path: orders
        includes: [total_amount]
      - join_path: orders.line_items
        includes: [count]
    measures:
      - name: average_line_value
        type: number
        multi_stage: true
        sql: "{CUBE.total_amount} / NULLIF({CUBE.count}, 0)"
```

## 治理参数

- `title` / `description` / `public`（默认 true）/ `meta`（含 `ai_context`）。
- **`extends`**：继承另一个 view 的全部声明成员。
- **`folders`**：把视图成员组织成逻辑分组（可嵌套、可在 includes 中混用 `join_path` 整体纳入）。
- **`default_filters`**：对**每个查询强制生效**的默认过滤（治理场景，如租户/地区）。参数：`member`、`operator`（REST API 风格：`equals`、`inDateRange` 等）、`values`、`unless`（查询引用列出的成员时释放该默认过滤）。
- **`meta.default_ui_filters`**（Cube Cloud）：仅为 workbook/嵌入端预填**可编辑的**默认过滤（不强制），operator 用过滤栏标签（`is`、`between` 等），相对日期值如 `yesterday`、`7 days ago`、`this month`。
- **`meta.auto_run: false`**（Cube Cloud）：workbook 查询不自动执行。
