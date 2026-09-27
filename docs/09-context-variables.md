# Context Variables（上下文变量）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/context-variables
>
> 阅读成果编号 09（修订版：补充完整说明与示例）。

## 是什么

Cube 定义（cube/view 的 `sql`、`sql_table` 等）中可用的**上下文变量**，用于动态 SQL 生成和动态数据模型构建。共 5 个（外加 1 个已废弃）：

| 变量 | 用途 |
| --- | --- |
| `CUBE` | 引用**当前 cube** 的列或成员 |
| `FILTER_PARAMS` / `FILTER_GROUP` | 优化生成的 SQL（谓词下推） |
| `SQL_UTILS` | 时区转换（`convertTz`） |
| `COMPILE_CONTEXT` | 构建**动态数据模型**（多租户等） |
| `SECURITY_CONTEXT`（已废弃） | API 传入的安全上下文，随时可能移除，改用 `query_rewrite` |

---

## CUBE

引用**当前 cube** 的列或成员，不必反复写 cube 名，保持模型代码 DRY、易维护。列和成员引用都适用（YAML 写 `{CUBE}`，JS 模板字符串写 `${CUBE}`）。

```yaml
cubes:
  - name: users
    sql_table: users

    joins:
      - name: contacts
        sql: "{CUBE}.contact_id = {contacts.id}"
        relationship: one_to_one

    dimensions:
      - name: id
        sql: "{CUBE}.id"
        type: number
        primary_key: true

      - name: name
        sql: "COALESCE({CUBE.name}, {contacts.name})"
        type: string

  - name: contacts
    sql_table: contacts
    dimensions:
      - name: id
        sql: "{CUBE}.id"
        type: number
        primary_key: true
      - name: name
        sql: "{CUBE}.name"
        type: string
```

注意 `{CUBE.name}` 这种「引用其他 cube 成员」的写法会让 Cube 触发**隐式 join**（详见编号 10 文档「引用方式」一节）。

---

## FILTER_PARAMS

在 SQL 生成阶段使用 Cube 查询中的**过滤值（filter values）**。核心价值：

- 提示数据库优化器使用特定索引；
- 在云端数仓中**过滤分区（partition）/ 分片（shard）**，避免为扫描无关数据付费；
- 构建维度间的 `links`（引用）。

> ⚠️ **最佳实践**：大量使用 `FILTER_PARAMS` 属于坏实践，通常导致模型难以维护。经验法则：**只用于谓词下推性能优化**。如果发现自己严重依赖它，说明需要重新审视建模方式——考虑把部分转换上移（upstream）到数仓层，或重新选择数据源。

### 语法

`FILTER_PARAMS` 必须是 `WHERE` 的**顶层表达式**：

```yaml
cubes:
  - name: cube_name
    sql: |
      SELECT *
      FROM table
      WHERE {FILTER_PARAMS.cube_name.member_name.filter(sql_expression)}

    dimensions:
      - name: member_name
        # ...
```

`filter()` 接受 `sql_expression`——可以是**字符串**，也可以是**返回字符串的函数**。

### 示例一：字符串（最常用）

```yaml
cubes:
  - name: order_facts
    sql: |
      SELECT *
      FROM orders
      WHERE {FILTER_PARAMS.order_facts.date.filter('date')}

    measures:
      - name: count
        type: count
    dimensions:
      - name: date
        sql: date
        type: time
```

查询传入 `order_facts.date` 的日期范围 `['2018-01-01', '2018-12-31']`：

```json
{
  "measures": ["order_facts.count"],
  "time_dimensions": [
    { "dimension": "order_facts.date", "dateRange": ["2018-01-01", "2018-12-31"] }
  ]
}
```

生成的 SQL（字符串 `'date'` 指明用哪一列承载过滤）：

```sql
SELECT COUNT(*) AS orders__count
FROM orders
WHERE
  date >= '2018-01-01 00:00:00' AND
  date <= '2018-12-31 23:59:59'
```

### 示例二：函数（BigQuery 分片过滤，降低计费）

```yaml
cubes:
  - name: events
    sql: |
      SELECT *
      FROM schema.`events*`
      WHERE {FILTER_PARAMS.events.date.filter(
        lambda x, y: f"""
          _TABLE_SUFFIX >= FORMAT_TIMESTAMP('%Y%m%d', TIMESTAMP({x})) AND
          _TABLE_SUFFIX <= FORMAT_TIMESTAMP('%Y%m%d', TIMESTAMP({y}))
        """
      )}

    dimensions:
      - name: date
        sql: date
        type: time
```

```javascript
cube(`events`, {
  sql: `
    SELECT *
    FROM schema.\`events*\`
    WHERE ${FILTER_PARAMS.events.date.filter(
      (x, y) => `
        _TABLE_SUFFIX >= FORMAT_TIMESTAMP('%Y%m%d', TIMESTAMP(${x})) AND
        _TABLE_SUFFIX <= FORMAT_TIMESTAMP('%Y%m%d', TIMESTAMP(${y}))
      `
    )}
  `,
  dimensions: { date: { sql: `date`, type: `time` } }
})
```

> ⚠️ 传函数时，参数（如日期范围上下界 `x`、`y`）以**字符串**形式从数据源驱动器传入，**类型转换由你自己负责**。

过滤接受多个值时，各值作为**独立参数**依次传入函数：

```javascript
cube(`multi_filter`, {
  sql: `
    SELECT 123 AS value
    -- Multiple values: ${FILTER_PARAMS.multi_filter.dummy.filter(
      (...args) => JSON.stringify(args)
    )}
  `,
  dimensions: { dummy: { sql: `1`, type: `number` } }
})
```

### 示例三：绑定 segment

`FILTER_PARAMS` 的参数也可以是 **segment** 名。segment 不与值比较，所以传给 `filter()` 的是**整段谓词**而非列名：查询选中该 segment 时**原样渲染**，未选中时渲染 `1 = 1`。

```yaml
cubes:
  - name: events
    sql: |
      SELECT *
      FROM events
      WHERE {FILTER_PARAMS.events.start_load.filter(
        "evid = 115 AND action_group = 'load'"
      )}

    segments:
      - name: start_load
        sql: "{CUBE}.evid = 115 AND {CUBE}.action_group = 'load'"
```

说明：

- segment 自己的 `sql` 会给列加 cube 前缀（如 `{CUBE}.evid`），但该 cube 的 `sql` 构建作用域内没有这个前缀，所以下推的谓词要在 `filter()` 里**重述一遍**——与维度列的处理方式相同。
- 也可以传**无参函数**代替字符串（segment 没有过滤值可传）；**带参函数**会渲染成 `1 = 1`。
- ⚠️ segment 绑定**只被默认 SQL planner 支持**：设置 `CUBEJS_TESSERACT_SQL_PLANNER=false` 时，这种绑定始终渲染 `1 = 1`（不下推）。

### 示例四：time shift（日历 cube 的期间平移）

带 [`time_shift`](https://docs.cube.dev/reference/data-modeling/measures#time_shift) 的度量在**日历 cube（calendar cube）**上读取的是与查询报告期**不同**的期间：具体是哪些行记录在日历自己的表里，任何基于源列的表达式都无法复现。若下推绑定重述「报告期」会把扫描范围收窄到低于该期间实际需要的行，所以普通绑定**不渲染**——必须**显式寻址**这个 shift：

```yaml
cubes:
  - name: sales
    sql: |
      SELECT *
      FROM sales
      WHERE {FILTER_GROUP(
        FILTER_PARAMS.fiscal_calendar.report_date.filter('day_date'),
        FILTER_PARAMS.fiscal_calendar.report_date.time_shifts.prev_fiscal_year.filter(
          lambda x, y: f"day_date >= {x}::date - 364 AND day_date <= {y}::date - 364"
        )
      )}
```

```javascript
cube(`sales`, {
  sql: `
    SELECT *
    FROM sales
    WHERE ${FILTER_GROUP(
      FILTER_PARAMS.fiscal_calendar.report_date.filter(`day_date`),
      FILTER_PARAMS.fiscal_calendar.report_date.time_shifts.prev_fiscal_year.filter(
        (from, to) => `day_date >= ${from}::date - 364 AND day_date <= ${to}::date - 364`
      )
    )}
  `
})
```

要点：

- **每个绑定只在一处渲染**：普通绑定在未应用日历平移时渲染；`time_shifts.prev_fiscal_year` 绑定在应用该平移时渲染。若模型没有为查询应用的某个 shift 声明绑定，则什么都不下推，cube 的 `sql` 无限制扫描——结果正确，只是没有收窄优化。
- 绑定名是**日历 cube** 在其维度的 `time_shift` 里给平移起的名字；无论度量按名字还是按日历声明的 interval 引用该平移，都能匹配到。
- 传给回调的上下界是**报告期原始值（未平移）**：由模型自己声明该期间在表里对应哪些行（示例中用 `- 364` 映射到上一财年）。
- `time_shifts` 绑定**必须用双参数函数**——字符串列无法表达这种映射；查询对该成员的过滤若不是日期范围，会报错。
- 非日历 cube 维度上的普通 interval 平移**不需要**这些：普通绑定即可渲染，interval 直接作用到列上。
- ⚠️ shift 寻址同样**只被默认 SQL planner 支持**，`CUBEJS_TESSERACT_SQL_PLANNER=false` 时始终渲染 `1 = 1`。

---

## FILTER_GROUP

在 SQL 中**多次使用** `FILTER_PARAMS` 时，**必须**用 `FILTER_GROUP` 包裹。`FILTER_GROUP` 同样必须是 `WHERE` 的顶层表达式。

> ⚠️ 否则，把 `FILTER_PARAMS` 与 AND 以外的逻辑运算符组合、或 Cube 查询里使用了布尔运算符（`or`/`and`）过滤器时，可能生成**逻辑错误的 SQL**。

```yaml
cubes:
  - name: cube_name
    sql: |
      SELECT *
      FROM table
      WHERE {FILTER_GROUP(
        FILTER_PARAMS.cube_name.member_name.filter(sql_expression),
        FILTER_PARAMS.cube_name.another_member_name.filter(sql_expression)
      )}
```

### 反例：为什么需要 FILTER_GROUP

两个 `FILTER_PARAMS` 用 `OR` 硬编码组合：

```yaml
cubes:
  - name: filter_group
    sql: |
      SELECT *
        FROM (
          SELECT 1 AS a, 3 AS b UNION ALL
          SELECT 2 AS a, 2 AS b UNION ALL
          SELECT 3 AS a, 1 AS b
        ) AS data
        WHERE
          {FILTER_PARAMS.filter_group.a.filter("a")} OR
          {FILTER_PARAMS.filter_group.b.filter("b")}

    dimensions:
      - name: a
        sql: a
        type: number
      - name: b
        sql: b
        type: number
```

查询两个成员、各带一个 `gt` 过滤（filters 数组是 **AND 语义**）：

```json
{
  "dimensions": ["filter_group.a", "filter_group.b"],
  "filters": [
    { "member": "filter_group.a", "operator": "gt", "values": ["1"] },
    { "member": "filter_group.b", "operator": "gt", "values": ["1"] }
  ]
}
```

生成的 SQL **逻辑错误**：

```sql
SELECT "filter_group".a, "filter_group".b
FROM (
  SELECT * FROM ( ... ) AS data
  WHERE
    (a > 1) OR   -- ← 硬编码的 OR 传播到了内层 WHERE，逻辑错误
    (b > 1)
) AS "filter_group"
WHERE
  "filter_group".a > 1 AND
  "filter_group".b > 1
GROUP BY 1, 2
```

原因：Cube 在「外层」WHERE 正确用了 AND（filters 数组语义），但硬编码的 `OR` 传播到了「内层」WHERE，内外语义不一致。

改用 `FILTER_GROUP` 后，同一查询生成正确 SQL（内层也变为 AND）：

```yaml
sql: |
  SELECT * FROM ( ... ) AS data
  WHERE
    {FILTER_GROUP(
      FILTER_PARAMS.filter_group.a.filter("a"),
      FILTER_PARAMS.filter_group.b.filter("b")
    )}
```

```sql
  WHERE
    (a > 1) AND   -- ← 正确
    (b > 1)
```

`FILTER_GROUP` 还能正确处理查询中的**布尔运算符**过滤（`or` 嵌套）——内层正确传播 `OR`：

```json
{
  "filters": [
    { "or": [
      { "member": "filter_group.a", "operator": "gt", "values": ["1"] },
      { "member": "filter_group.b", "operator": "gt", "values": ["1"] }
    ]}
  ]
}
```

```sql
  WHERE
    (a > 1) OR    -- ← 布尔 or 正确传播到内层
    (b > 1)
```

---

## SQL_UTILS

### `SQL_UTILS.convertTz()`

在 cube/成员 SQL 中把时间戳转换为**用户请求的时区**。

> ⚠️ Cube 对查询中的 `timeDimensions` 字段**已自动做时区转换**。使用 `convertTz()` 的维度**不应**再作为查询的 `timeDimensions` 使用——否则会**重复转换**、产生错误结果。
> 若同一数据库字段既要用于 `dimensions` 又要用于 `timeDimensions`，请在 cube 中建**两个专用维度**分别承载两种用途：

```yaml
cubes:
  - name: visitors
    dimensions:
      # 不要用于查询的 timeDimensions 属性
      - name: created_at_converted
        sql: "{SQL_UTILS.convertTz(`created_at`)}"
        type: time

      # 用于查询的 timeDimensions 属性
      - name: created_at
        sql: created_at
        type: time
```

```javascript
cube(`visitors`, {
  dimensions: {
    created_at_converted: {           // 不要用于 timeDimensions
      sql: SQL_UTILS.convertTz(`created_at`),
      type: `time`
    },
    created_at: { sql: `created_at`, type: "time" }   // 用于 timeDimensions
  }
})
```

---

## COMPILE_CONTEXT

编译期全局变量，包含 `securityContext` 以及 `extendContext` 提供的其他变量，用于构建**动态数据模型**（如多租户）。

> ⚠️ `COMPILE_CONTEXT` 对 `context_to_app_id` 生成的**每个 key 只求值一次**：其中的 `securityContext` **不会**因不同用户而变化，但**会**因不同租户（`context_to_app_id` 映射）而变化。

YAML 中用 Jinja 的 `{{ }}` 语法访问；JS 中用 `${}`：

```yaml
cubes:
  - name: users
    sql_table: "user_{{ COMPILE_CONTEXT.securityContext.deployment_id }}.users"
```

```javascript
cube(`users`, {
  sql_table: `user_${COMPILE_CONTEXT.securityContext.deployment_id}.users`
})
```

更多用法（`context_to_app_id` 映射、`masked` 辅助函数、动态 `public`、配合 pre-aggregation 的 `scheduledRefreshContexts`）见编号 11 文档「Security Context」一节。

---

## SECURITY_CONTEXT（已废弃）

> ⚠️ **已废弃，且可能在没有进一步通知的情况下被移除。** 改用 `query_rewrite`。

持有 API 传入的安全上下文。可用方法：

- `.filter("email")`——基于安全上下文字段生成过滤条件：

```javascript
cube(`orders`, {
  sql: `
    SELECT *
    FROM orders
    WHERE ${SECURITY_CONTEXT.email.filter("email")}
  `,
  dimensions: { date: { sql: `date`, type: `time` } }
})
```

- `.requiredFilter("email")`——保证过滤值对**所有请求**都存在（缺失时报错）：

```javascript
cube(`orders`, {
  sql: `
    SELECT *
    FROM orders
    WHERE ${SECURITY_CONTEXT.email.requiredFilter("email")}
  `,
  dimensions: { date: { sql: `date`, type: `time` } }
})
```

- `.unsafeValue()`——在 JavaScript 中直接访问上下文变量的**原始值**用于 SQL 生成：

> ⚠️ 该特性存在 **SQL 注入安全风险**，需谨慎使用。

```javascript
cube(`orders`, {
  sql: `
    SELECT *
    FROM ${
      SECURITY_CONTEXT.type.unsafeValue() === "employee" ? "employee" : "public"
    }.orders
  `,
  dimensions: { date: { sql: `date`, type: `time` } }
})
```

---

## 要点速记

1. `CUBE` 引用当前 cube，保持 DRY；引用其他 cube 成员会触发隐式 join。
2. `FILTER_PARAMS` 只用于**谓词下推优化**（索引/分区/分片），大量使用是坏实践；必须是 WHERE 顶层表达式。
3. `filter()` 接受字符串（最常用）、函数（参数是字符串，类型转换自理）、segment 名（整段谓词，未选中渲染 `1 = 1`）、日历 cube 的 `time_shifts.<name>`（必须双参函数，映射期间）。
4. segment 绑定与 time shift 寻址**只被默认 SQL planner 支持**（`CUBEJS_TESSERACT_SQL_PLANNER=false` 时恒为 `1 = 1`）。
5. 多个 `FILTER_PARAMS` **必须**用 `FILTER_GROUP` 包裹，否则硬编码逻辑运算符会传播到内层 WHERE，生成逻辑错误 SQL。
6. `SQL_UTILS.convertTz()` 的维度不能再作 `timeDimensions`（双重转换）；同字段两种用途建两个维度。
7. `COMPILE_CONTEXT` 按 `context_to_app_id` 的 key 求值一次——随**租户**变化，不随用户变化。
8. `SECURITY_CONTEXT` 已废弃，改用 `query_rewrite`；`.unsafeValue()` 有 SQL 注入风险。
