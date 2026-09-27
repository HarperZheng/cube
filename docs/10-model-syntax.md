# Model Syntax（模型语法：目录结构 / 命名 / 引用方式）概念说明

> 参考文档：https://docs.cube.dev/docs/data-modeling/concepts/syntax
>
> 阅读成果编号 10，对应 docs.cube.dev「Data Modeling → Concepts → Syntax」页面。

## 是什么

规定 Cube 数据模型文件的**目录布局、命名规范、YAML vs JavaScript 语法选择**，以及模型内各种**引用（reference）写法**：列、成员、时间粒度、跨 cube 引用、join path、`{CUBE}` 变量、`{cube.sql()}` 函数等。

## 目录结构（Folder structure）

- 模型文件必须放在 `model` 文件夹下。
- 可用 `schema_path` 配置项覆盖目录名；用 `repository_factory` 动态定义目录名与文件内容。
- 推荐做法：每个 cube / view 单独一个文件，分别放 `model/cubes`、`model/views`；view group 可与 view 同文件或独立文件。

```tree
model
├── cubes
│   ├── orders.yml
│   ├── products.yml
│   └── users.yml
└── views
    ├── revenue.yml
    └── view_groups.yml
```

## 模型语法（YAML vs JavaScript）

- 两种语法：YAML（`.yml` 后缀）与 JavaScript（`.js` 后缀），**同一个模型内可混用**。
- 静态定义或程序化动态模型：YAML 用 Jinja + Python，JavaScript 用 JS 本身。
- 官方建议**默认用 YAML**（简洁可读），需要更强动态能力时用 JavaScript。

```yaml
cubes:
  - name: orders
    sql: |
      SELECT *
      FROM orders, line_items
      WHERE orders.id = line_items.order_id
```

```javascript
cube(`orders`, {
  sql: `
    SELECT *
    FROM orders, line_items
    WHERE orders.id = line_items.order_id
  `
})
```

## 命名规范（Naming）

所有实体名称必须：

- 以**字母**开头；
- 只含字母、数字、下划线 `_`；
- 不是 Python 保留关键字（如 `from`、`return`、`yield`）；
- 使用 DAX API 时，不得与日期层级（date hierarchy）的列名冲突；
- 在其**作用域内唯一**：cube/view 名全局唯一；成员（measure、dimension、segment、pre-aggregation、hierarchy）在其 cube 内唯一；文件夹名在其 view 内唯一。重复会报错。

建议用 snake_case。命名示例：

| 实体 | 好的名字 |
| --- | --- |
| cube | `orders`、`stripe_invoices`、`base_payments` |
| view | `opportunities`、`cloud_accounts`、`arr` |
| measure | `count`、`avg_price`、`total_amount_shipped` |
| dimension | `name`、`is_shipped`、`created_at` |
| pre-aggregation | `main`、`orders_by_status`、`lambda_invoices` |

## SQL 表达式（SQL expressions）

- `sql` / `sql_table` 中的 SQL 片段要**匹配数据库方言**（如 Snowflake 用 `LISTAGG`、BigQuery 用 `STRING_AGG`）。
- 数据源中的用户自定义函数（UDF）可直接用于 `sql`。
- **大小写敏感**：数据库标识符大小写敏感时须正确加引号，如 Postgres：`sql_table: 'public."Orders"'`。

⚠️ 注意：Cube 目前**不会**给 SQL 片段自动加括号，复杂片段可能产生意外结果（见 cube 仓库 issue #6373）。

## 引用方式（References）—— 核心

### 1. 裸列名 `column`

`sql` 中直接写列名，引用本 cube 底层表的列：

```yaml
dimensions:
  - name: name
    sql: name
    type: string
```

简单场景够用；但有 join 且 join 的 cube 存在同名列时，生成的 SQL 可能**歧义**。

### 2. `{member}` 引用同 cube 成员

用花括号引用同 cube 其他成员（JS 中用 `${member}`）：

```yaml
dimensions:
  - name: full_name
    sql: "CONCAT({name}, ' ', {surname})"
    type: string
```

✅ 可以安全引用**复合表达式**成员（如 `{price} + {tax}`、`{is_paid} OR {is_pending}`）：当被引用成员出现在算术/逻辑表达式中时，Cube 会**自动加括号保证运算优先级**（如 `{price_with_tax} * {quantity}` 生成 `(price + tax) * quantity`）；已处于安全位置（如函数参数 `ABS({...})`、`CAST(...)`）时不加括号。

### 3. `{time_dimension.granularity}` 时间粒度引用

引用时间维度时可指定粒度（默认粒度如 `year`/`week`，或自定义粒度）：

```yaml
dimensions:
  - name: created_at
    sql: created_at
    type: time
    granularities:
      - name: sunday_week
        interval: 1 week
        offset: -1 day

  - name: created_at__year
    sql: "{created_at.year}"
    type: time
```

### 4. `{cube}.column`、`{cube.member}` 跨 cube 限定引用

用 cube 名限定列/成员，消除 join 歧义、引用其他 cube 的成员。**生产环境推荐全限定名**，但总写当前 cube 名违反 DRY——用下面的 `{CUBE}` 解决。

```yaml
joins:
  - name: contacts
    sql: "{users}.contact_id = {contacts.id}"
    relationship: one_to_one

dimensions:
  - name: name
    sql: "COALESCE({users.name}, {contacts.name})"
    type: string
```

在维度定义中引用其他 cube 会触发**隐式 join**：查询 `users.name` 生成：

```sql
SELECT COALESCE("users".name, "contacts".name) "users__name"
FROM users "users"
LEFT JOIN contacts "contacts"
  ON "users".contact_id = "contacts".id
```

### 5. `{cube1.cube2.member}` 多级 join path

用多个 cube 名（点号分隔）指定 **join path**，消除 join 解析歧义。适用于**菱形子图（diamond subgraph）**：`a` join 到 `b`、`c`，二者都 join 到 `d`——用 `d_via_b` / `d_via_c` 指明经由哪个中间 cube 解析 `d` 的维度：

```yaml
- name: d_via_b
  sql: "{b.d.id}"
  type: number

- name: d_via_c
  sql: "{c.d.id}"
  type: number
```

Join path 可用于 calculated members、views、pre-aggregation 定义。

### 6. `{CUBE}` 变量

大写的 `{CUBE}` 引用**当前 cube**（列和成员都适用），避免重复写 cube 名：

```yaml
joins:
  - name: contacts
    sql: "{CUBE}.contact_id = {contacts.id}"
    relationship: one_to_one

dimensions:
  - name: id
    sql: "{CUBE}.id"
    type: number
    primary_key: true
```

### 7. `{cube.sql()}` 函数

引用另一个 cube 的 `sql` 参数，复用其 SQL 查询。常用于**多态 cube（polymorphic cubes）**和**数据混合（data blending）**：

```yaml
cubes:
  - name: organisms
    sql_table: organisms

  - name: animals
    sql: |
      SELECT *
      FROM {organisms.sql()}
      WHERE kingdom = 'animals'

  - name: dogs
    sql: |
      SELECT *
      FROM {animals.sql()}
      WHERE species = 'dogs'
```

查询 `dogs.count` 生成嵌套子查询：

```sql
SELECT count(*) "dogs__count"
FROM (
  SELECT *
  FROM (
    SELECT * FROM organisms WHERE kingdom = 'animals'
  )
  WHERE species = 'dogs'
) AS "dogs"
```

### 花括号转义

- YAML 中引用写 `{reference}`；JavaScript 模板字符串中写 `${reference}`（注意有 `$`）。
- YAML 中需要**字面量**花括号（如定义 JSON 对象）时用反斜杠转义：

```yaml
- name: csv_from_s3_in_duckdb
  sql: |
    SELECT *
    FROM read_csv(
      's3://bbb/aaa.csv',
      delim = ',',
      header = true,
      columns=\{'time':'DATE','count':'NUMERIC'\}
    )
```

### 非 SQL 上下文中的引用

在 `sql` / `sql_table` **之外**（如 pre-aggregation 定义），裸名不再识别为列名，而是**成员名**——可省略花括号直接写 `member`、`cube_name.member` 或 `CUBE.member`：

```yaml
pre_aggregations:
  - name: orders_by_status
    dimensions:
      - CUBE.status
    measures:
      - CUBE.count
```

## 上下文变量（Context variables）

除 `{CUBE}` 外还有其他上下文变量（详见编号 09 文档），两大用途：**优化生成的 SQL** 与 **定义动态数据模型**。

## 排错（Troubleshooting）

### `Can't parse timestamp`

报错如 `Can't parse timestamp: 2023-11-07T14:33:23.16.000`，说明数据源无法把时间维度的值识别为时间戳。检查该时间维度的 `sql` 表达式求值结果是否为 `TIMESTAMP` 类型；字符串型时间维度可用官方 recipe 绕过。
