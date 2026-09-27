# Access Control（访问控制：Access Policies / 行级 / 成员级 / Security Context）概念说明

> 参考文档（docs.cube.dev「Data Modeling → Access Control」及其全部子页）：
> - https://docs.cube.dev/docs/data-modeling/access-control
> - https://docs.cube.dev/docs/data-modeling/data-access-policies（概念页）
> - https://docs.cube.dev/reference/data-modeling/data-access-policies（参数参考页）
> - https://docs.cube.dev/docs/data-modeling/access-control/row-level-security
> - https://docs.cube.dev/docs/data-modeling/access-control/member-level-security
> - https://docs.cube.dev/docs/data-modeling/access-control/context
>
> 阅读成果编号 11（修订版：Access Policies 按参数逐个给出 YAML 示例）。

## 总览：认证 vs 授权

Cube 的访问控制分为两块：

- **认证（Authentication）**——决定用户**能否访问** Cube：
  - Cube Cloud：内置认证机制，用户被分配角色与权限（决定平台功能可用性）。
  - Cube Core：为 API 端点提供多种认证方法（如 JWT）。
- **授权（Authorization）**——决定用户**能访问哪些数据**：
  - 主要方式：**访问策略（access policies）**——数据建模层的声明式能力。
  - 高级场景的程序化控制：`query_rewrite` 配置项。
  - Cloud 平台：基于用户的 **groups** 与 **attributes** 应用策略。
  - Cube Core：基于从 **security context** 派生的 groups（见 `context_to_groups` 配置项）。

---

## 一、Access Policies（访问策略）

### 是什么

访问策略提供统一机制，为不同用户组管理**成员级安全**、**行级安全**和**数据脱敏（data masking）**。规则直接写在数据模型文件里（`access_policy` 参数），便于组织和维护。

策略作用于 cube 和 view，**更常见的做法是定义在 view 上**。

### 参数总览

`access_policy` 是一个**策略列表**，每条策略可用以下参数配置：

| 参数 | 必填 | 用途 |
| --- | :---: | --- |
| `group` / `groups` | ✅ | 定义策略作用于哪个（些）用户组 |
| `conditions` | 可选 | 定义策略**生效前提**（`if` 条件全部为 true 才生效） |
| `member_level` | 可选 | 配置**成员级**访问（允许/禁止的成员） |
| `row_level` | 可选 | 配置**行级**访问（结果集行过滤） |
| `member_masking` | 可选 | 为不在 `member_level` 中的成员配置**脱敏** |

> ✅ 为特定组定义策略后，**其他所有组自动被拒绝**——不需要再写默认拒绝策略。

---

### `group` —— 策略作用于哪个组

定义单条策略的目标用户组。用户所属组匹配该参数时，这条策略对该用户生效；其他组自动拒绝。

- 一个组一条策略，不同组可以有不同的成员/行/脱敏配置；
- `group: "*"` 是**任意组**简写，策略对所有用户生效（常用于默认脱敏/默认禁止）。

```yaml
cubes:
  - name: orders
    access_policy:
      # `marketing` 组用户适用这条策略
      - group: marketing
        member_level:
          includes: "*"

      # `finance` 组用户适用这条策略
      - group: finance
        member_level:
          includes: "*"
```

---

### `groups` —— 一条策略作用于多个组

复数形式，用**数组**把同一份策略配置同时应用到多个组，避免重复：

```yaml
cubes:
  - name: orders
    access_policy:
      # `analysts` 和 `managers` 两个组共用这条策略
      - groups: [analysts, managers]
        member_level:
          includes: "*"
```

---

### `conditions` —— 策略生效前提（可选）

定义一个 `if` 条件列表：**全部为 true** 时策略才生效；任一为 false 则该策略对用户不生效（如同不存在）。`if` 表达式引用 **security context 或用户属性**，实现「同一组内按用户属性细分权限」。

**示例一：宽策略加条件**——`*` 组的宽松策略只对 EMEA 用户生效（由 `is_EMEA_based` 用户属性决定），其他地区用户不受这条策略影响：

```yaml
cubes:
  - name: orders
    access_policy:
      - group: "*"
        conditions:
          - if: "{ userAttributes.is_EMEA_based }"
        member_level:
          includes: "*"
```

**示例二：同组多条策略叠加**——同一 `manager` 组定义两条策略，条件不同、暴露的成员不同（成员访问取并集）：

```yaml
cubes:
  - name: orders
    access_policy:
      # 全职的 manager：只能看 status、count
      - group: manager
        conditions:
          - if: "{ userAttributes.is_full_time_employee }"
        member_level:
          includes: [status, count]

      # 全职且完成隐私培训的 manager：看全部成员
      - group: manager
        conditions:
          - if: "{ userAttributes.is_full_time_employee }"
          - if: "{ userAttributes.has_completed_privacy_training }"
        member_level:
          includes: "*"
```

**`if` 表达式语法**：必须是布尔值。YAML 数据模型中 `{ }` 内按 **Python 表达式**求值，**只支持逻辑运算符、成员访问、方法调用**（不支持比较、算术、三元）；JavaScript 模型支持更广的运算符集。

| 运算符 | YAML（Python） | JavaScript |
| --- | :---: | :---: |
| 逻辑 AND / OR / NOT | `and` / `or` / `not` | `&&` / `\|\|` / `!` |
| 成员访问 | `.` | `.` |
| 方法调用（如 `includes`） | `.includes(…)` | `.includes(…)` |
| 相等/不等 | — | `===`、`!==`、`==`、`!=` |
| 比较 / 算术 / 三元 | — | 支持 |
| 可选链 | — | `?.` |

```yaml
conditions:
  - if: "{ not userAttributes.is_blocked }"
  - if: "{ userAttributes.is_admin or userAttributes.is_EMEA_based }"
  - if: "{ userAttributes.groups.includes('admins') }"
```

> 💡 用 AND 串联的长条件建议**拆成多条 conditions**——conditions 之间本就是 AND 组合，等价但更易读易维护。

---

### `member_level` —— 成员级访问（能看什么）

配置该策略的**成员可见性**，控制用户能查询哪些维度/度量（类比 SQL 的列）：

- `includes`：**允许**成员列表（白名单）；
- `excludes`：**禁止**成员列表（黑名单）；
- `"*"`：全部成员简写（`includes: "*"` / `excludes: "*"`）；
- 策略**不写** `member_level` 时默认**全部成员**可见。

```yaml
cubes:
  - name: orders
    access_policy:
      - group: manager
        member_level:
          # 黑名单：除 count 外全部成员
          excludes:
            - count

      - group: observer
        member_level:
          # 黑名单：除 count、count_7d 外全部成员
          excludes:
            - count
            - count_7d

      - group: guest
        member_level:
          # 白名单：只有 count_30d，其余全部拒绝
          includes:
            - count_30d
```

对应的访问效果：

| 组              | 访问                                        |
| --------------- | ------------------------------------------- |
| `manager`       | 除 `count` 外全部成员                       |
| `observer`      | 除 `count`、`count_7d` 外全部成员           |
| `guest`         | 仅 `count_30d`                              |
| 其他所有组      | 完全无权访问此 cube                         |

成员级策略与成员上的 `public` 参数 **AND 组合**（都生效）。

---

### `member_masking` —— 数据脱敏（可见但脱敏）

对**不在** `member_level` 白名单里的成员返回**脱敏值**而不是直接拒绝。**必须与 `member_level` 在同一条策略中定义**。三档规则：

1. `member_level` 中的成员 → **真实值**；
2. 不在 `member_level` 但在 `member_masking` 中 → **脱敏值**（由成员上的 `mask` 参数定义，默认 `NULL`）；
3. 两者都不在 → **拒绝**。

`member_masking` 同样支持 `includes`（可脱敏名单）/ `excludes`（不可脱敏名单）/ `"*"`。

```yaml
cubes:
  - name: orders
    # 脱敏值由成员上的 mask 参数定义
    dimensions:
      - name: secret_code
        sql: secret_code
        type: string
        mask:
          sql: "CONCAT('***', RIGHT({CUBE}.secret_code, 3))"   # SQL 脱敏
      - name: revenue
        sql: revenue
        type: number
        mask: -1                                               # 静态脱敏
    measures:
      - name: count
        type: count
        mask: 0

    access_policy:
      - group: manager
        member_level:
          includes: [status, count]     # 真实值
        member_masking:
          includes: "*"                 # 其余成员：脱敏值
```

`manager` 组用户看到：`status`/`count` 真实值；`secret_code` 经 SQL 脱敏为 `***xyz`；`revenue` 脱敏为 `-1`；未定义 `mask` 的成员脱敏为 `NULL`（可用环境变量 `CUBEJS_ACCESS_POLICY_MASK_STRING` / `_NUMBER` / `_BOOLEAN` / `_TIME` 自定义默认脱敏值）。

⚠️ 度量上的 **SQL 脱敏**（`mask: { sql: "..." }`）在**非分组查询**（如 SQL API 的 `SELECT *`）中**不生效**；**静态脱敏**（`mask: -1`）任何情况都生效。若需在非分组查询中动态脱敏度量，改用带 SQL mask 的**维度**。

**多策略下的脱敏**——成员访问取并集，**完全访问优先于脱敏**：

- 任一匹配策略通过 `member_level`（且无 `row_level` 过滤）授予该成员 → 用户看到**真实值**；
- **仅脱敏**：成员只通过 `member_masking` 暴露 → 所有行都脱敏；
- **条件脱敏**：另一策略给予完全访问**且**定义了 `row_level` 过滤 → 按行条件脱敏，生成 SQL 近似 `CASE WHEN {rowFilter} THEN {value} ELSE {mask} END`。典型组合——`*` 组看脱敏值，窄策略按 `row_level` 只对有权行显示真实值：

```yaml
views:
  - name: orders_view
    access_policy:
      - group: "*"                      # 默认：全部成员脱敏
        member_level:
          includes: []
        member_masking:
          includes: "*"
      - group: regional_manager         # 有权组：只对自己的区域显示真实值
        member_level:
          includes: "*"
        row_level:
          filters:
            - member: region
              operator: equals
              values: [ "{ userAttributes.region }" ]
```

条件脱敏是**逐行**求值的；**聚合度量**（`sum`、`count`）的 `CASE WHEN` 只有当行过滤引用的成员出现在查询 `GROUP BY` 中才能应用，否则整个度量完全脱敏。💡 想拿到行感知的度量值：把行过滤的成员加进查询的 dimensions。

---

### `row_level` —— 行级访问（能看哪些行）

配置该策略的**行过滤**，控制用户能看到哪些记录（类比 SQL 的行）。**默认全部行**；定义了 `filters` 后结果被收窄；显式写 `allow_all: true` 表示全行。

`filters` 是过滤条件列表，**多条过滤之间 AND 组合**。每条过滤用 `member` + `operator` + `values` 三元组，格式与 REST（JSON）API 查询的过滤器一致，可用同一套运算符（`equals`、`contains`、`gte` 等）。

**示例一：按用户属性过滤行**——`manager` 组只能看 `state` 与 security context/用户属性一致的行，其他组一行都看不到：

```yaml
cubes:
  - name: orders
    access_policy:
      - group: manager
        row_level:
          filters:
            - member: state
              operator: equals
              values: [ "{ userAttributes.state }" ]
```

**示例二：多用户属性匹配**——`values` 数组传多个属性，任一匹配即可（用户可基于多个属性获得访问权）：

```yaml
access_policy:
  - group: manager
    row_level:
      filters:
        - member: users_country
          operator: equals
          values: [ "{ userAttributes.country }", "{ userAttributes.customCountryProperty }" ]
```

**示例三：布尔组合**——`and` / `or` 参数可把多条过滤组合成布尔逻辑（格式与 REST API 相同）：

```yaml
access_policy:
  - group: manager
    row_level:
      filters:
        - and:
            - member: users_country
              operator: equals
              values: [ "{ userAttributes.country }" ]
            - member: created_at
              operator: afterDate
              values: [ "2024-01-01" ]
```

**示例四：静态强制过滤**——固定值强制条件（如某组只能看巴西数据）：

```yaml
access_policy:
  - groups: [sales, marketing]
    member_level:
      includes: "*"
    row_level:
      filters:
        - member: users_country
          operator: equals
          values: [ "Brasil" ]
```

行级策略与 `query_rewrite` 过滤**AND 组合**；查询 view 时，view 与相关 cube 的行级过滤**叠加生效**。

**Cloud vs Core**：`userAttributes` 只在 Cube Cloud 可用；Cube Core / Core Data API 场景下直接用 `securityContext`（如 `securityContext.country`）：

```yaml
access_policy:
  - group: manager
    row_level:
      filters:
        - member: country
          operator: equals
          values: [ "{ securityContext.country }" ]
```

---

### 策略求值：二维权限空间（核心心智模型）

把访问控制想成一个**二维权限空间**：一个轴是**成员**——用户能看*什么*（维度、度量）；另一个轴是**行**——用户能看*哪些记录*。

每条策略授予该空间的一个**矩形区域**：`member_level` 决定水平范围，`row_level` 决定垂直范围，`member_masking` 把区域一部分标为「可见但脱敏」。默认值**放宽**：无 `row_level` = 全部行；无 `member_level` = 全部成员。

用户通常匹配多条策略（属于多个组），有效权限是**所有匹配策略区域的组合**：

1. **成员取并集（union）**：任一匹配策略授予的成员即可访问——即使没有单条策略暴露全部。
2. **行在所查成员之间取交集（intersect）**：对每个被查询成员，可见行 = 授予该成员的各策略行过滤的**并集**（无行过滤的策略不增加限制）；一行只有在**所有**被查成员下都可见才返回。
3. **脱敏**：没有任何匹配策略通过 `member_level` 给予无条件完全访问、但有策略把它列在 `member_masking` 下 → 该成员脱敏显示。
4. **拒绝**：被查成员没有任何匹配策略授予 → 空结果。

图解：`orders_view` 被 `support` 组（`member_level: [status, count]`，行限制 `region = 'US'`）和 `finance` 组（`member_level: [count, revenue]`，行限制 `region = 'EU'`）同时匹配：

```text
  members
         ▲
         │          ┌───────────────────────────────────────┐
 revenue │          │            finance policy             │
         │ ┌────────┼──────────────┐                        │
   count │ │        │   overlap    │                        │
         │ │        └──────────────┼────────────────────────┘
  status │ │    support policy     │
         │ └───────────────────────┘
         └───────────────────────────────────────────────────▶ rows
                   US region                EU region
```

**可见行取决于查询了哪些成员**（行在成员之间取交集）：

| 查询成员                     | 行解析方式           | 可见行              |
| ---------------------------- | -------------------- | ------------------- |
| `status`, `count`            | `US` ∩ (`US` ∪ `EU`) | `US` 行             |
| `count`, `revenue`           | (`US` ∪ `EU`) ∩ `EU` | `EU` 行             |
| `count`                      | `US` ∪ `EU`          | 全部行              |
| `status`, `count`, `revenue` | `US` ∩ `EU`          | 无（空结果）        |

> ⚠️ 无 `row_level` 过滤的策略默认**全部行**（allow-all）。只有当授予成员的策略定义了行过滤时，结果才会被收窄。

### 与其他安全规则的组合语义

| 场景 | 组合方式 |
| --- | --- |
| 成员级策略规则 vs cube/view 成员的 `public` 参数 | **AND** 组合，二者都生效 |
| 查询 **view** 时：view 的成员级规则 vs 相关 cube 的成员级规则 | **不组合**，只有 view 的规则生效（类比 SQL：view 暴露表的列子集时，表中列是否 public 无关紧要） |
| 行级策略规则 vs `query_rewrite` 过滤 | **组合**，二者都生效 |
| 查询 view 时：view 的行级规则 vs 相关 cube 的行级规则 | **组合**，二者都生效（类比 SQL：view 之上再叠 view，两层的行级规则都过滤） |
| 查询 view 时的脱敏 | 与行级安全同模式：view 和相关 cube 的脱敏规则**都应用** |

### 自定义组映射（Cube Core）

Cloud 平台自动把认证用户映射到组；使用 Cube Core 或直接对接 Core Data API 时需手动把 security context 映射为 groups（用户可属于多个组）：

```yaml
# 配置文件 cube.py（Python）或 cube.js（JavaScript）中定义
```

```python
from cube import config

@config('context_to_groups')
def context_to_groups(ctx: dict) -> list[str]:
  return ctx['securityContext'].get('groups', ['default'])
```

---

## 二、Row-Level Security（行级安全）

### 是什么

数据模型是数据的外立面（facade）。行级安全定义模型的**事实（facts）**是否暴露给终端用户、能否通过 API 与集成查询——类比 SQL 数据库的行级安全：定义对 cube/view 的访问 ≈ 定义对数据库表的行的访问。

**默认所有行都是 public**：任何用户访问时不做任何过滤。

### 管理方式

用 access policies 的 `row_level` 参数按组与用户属性管理行级（和成员级）安全，见上文 `row_level` 一节。

---

## 三、Member-Level Security（成员级安全）

### 是什么

定义模型**实体**（cube、view 及其成员）是否暴露给终端用户并可被查询——类比 SQL 的**列级安全**：cube/view 的访问 ≈ 表访问；维度/度量的访问 ≈ 列访问。

**默认所有 cube、view 及其成员都是 public**：任何用户可访问，且在数据模型内省（introspection）时可见。

### 管理方式

在 cube/view 的 `access_policy` 中用 `member_level` 参数管理，见上文 `member_level` 一节。若想对受限成员返回**脱敏值**而不是完全隐藏，用 `member_masking`。

---

## 四、Security Context（安全上下文）

### 是什么

认证服务器向客户端应用签发 JWT；请求携带 JWT 时，Cube 用行业标准 **JWKS（JSON Web Key Sets）**验证并解码，得到安全上下文声明用于评估访问控制规则。

- JWT 通过 `Authorization: <JWT>` 请求头传递。
- JWT 还可携带用户的附加信息，即**安全上下文（security context）**——一组**经过验证**的当前用户声明，保证用户只访问其被授权的数据。
- 以 `securityContext` 属性出现在：
  - 配置文件的 `query_rewrite` 配置项；
  - `COMPILE_CONTEXT` 全局变量（支持多租户部署）。

### 内容与保留元素

按惯例应为**对象（字典）**，支持嵌套结构：

```json
{
  "sub": "1234567890",
  "iat": 1516239022,
  "user_name": "John Doe",
  "user_id": 42,
  "location": { "city": "San Francisco", "state": "CA" }
}
```

⚠️ Cube Cloud 的某些功能（如认证集成）使用保留元素 `cubeCloud`，不要挪作他用。
⚠️ JWT payload 必须是对象，否则报错：`Cannot create proxy with a non-object as target or handler`。

### 用法一：query_rewrite（查询重写）

给进入的查询追加过滤。如查询 `orders_view.count` + `orders_view.status`，JWT payload `{ "sub": "...", "iat": ..., "user_id": 42 }`，让用户只看到自己的订单：

```javascript
module.exports = {
  queryRewrite: (query, { securityContext }) => {
    if (securityContext.user_id) {
      query.filters.push({
        member: "orders_view.users_id",
        operator: "equals",
        values: [securityContext.user_id]
      })
    }
    return query
  }
}
```

```python
from cube import config

@config('query_rewrite')
def query_rewrite(query: dict, ctx: dict) -> dict:
  if 'user_id' in ctx['securityContext']:
    query['filters'].append({
      'member': 'orders_view.users_id',
      'operator': 'equals',
      'values': [ctx['securityContext']['user_id']]
    })
  return query
```

生成测试 token（JWT 放入 `Authorization` 头）：

```javascript
const jwt = require("jsonwebtoken")
const cubeToken = jwt.sign({ user_id: 42 }, "secret", { expiresIn: "30d" })
```

```bash
curl -H "Authorization: <JWT>" \
  -G --data-urlencode 'query={"measures":["orders.count"]}' \
  http://localhost:4000/cubejs-api/v1/load
```

生成的 SQL 中会带上 `WHERE ("users".ID = 42)` 行级约束。

### 用法二：COMPILE_CONTEXT（编译期上下文，动态模型）

创建完全动态的数据模型：基于 security context 生成模型的多个版本。

1. 用 `context_to_app_id` 定义 security context → 编译模型 id 的映射（常用 `team` 等字段）：

```python
from cube import config

@config('context_to_app_id')
def context_to_app_id(ctx: dict) -> str:
  return ctx['securityContext']['team']
```

2. 在模型中使用 `COMPILE_CONTEXT`，如传入 `masked` 辅助函数做字段级脱敏（受信任团队看真实 SQL，否则返回 `'--- masked ---'`）：

```yaml
cubes:
  - name: users
    sql_table: ECOM.USERS
    public: false
    dimensions:
      - name: last_name
        sql: {{ masked('LAST_NAME', COMPILE_CONTEXT.securityContext) }}
        type: string
```

```python
# model/globals.py
from cube import TemplateContext

template = TemplateContext()

@template.function('masked')
def masked(sql, security_context):
  trusted_teams = ['cx', 'exec']
  is_trusted_team = security_context.setdefault('team') in trusted_teams
  return sql if is_trusted_team else "'--- masked ---'"
```

**与 pre-aggregation 一起用**：依赖 `COMPILE_CONTEXT` 的预聚合需在 `cube.js` 中配置 `scheduledRefreshContexts`。

**用于成员级安全（动态 public）**：动态控制实体 public/private，如 `customers` view 只对 `team = marketing` 的租户可见：

```yaml
# model/views/customers.yml
views:
  - name: customers
    public: "{{ is_accessible_by_team('marketing', COMPILE_CONTEXT) }}"
```

```python
@template.function('is_accessible_by_team')
def is_accessible_by_team(team: str, ctx: dict) -> bool:
  return team == ctx['securityContext'].setdefault('team', 'default')
```

若想保持实体 public 但仍阻止访问，用 `query_rewrite` 实现。

### 开发期测试

Developer Playground 可设置自定义 JWT，或从 JSON 对象构建 JWT，用于测试访问控制规则。

### 丰富安全上下文

- `extend_context` 配置项：给 security context 追加属性（如派生布尔标志）：

```javascript
module.exports = {
  extendContext: ({ securityContext }) => {
    return {
      securityContext: {
        ...securityContext,
        isFinance: securityContext.department === "finance"
      }
    }
  }
}
```

- Cube Cloud 认证集成：在 **Settings → Configuration** 打开 **Enable Cloud Auth Integration**，把认证期间获得的用户信息注入 security context。

### 常用模式

**1. 强制过滤（所有查询都加，如日期下限）**：

```javascript
queryRewrite: (query) => {
  query.filters.push({
    member: `orders.created_at`,
    operator: "afterDate",
    values: ["2019-12-30"]
  })
  return query
}
```

**2. 按角色强制访问**（`operator` 角色只见 processing 订单，`manager` 见 shipped/completed）：

```javascript
queryRewrite: (query, { securityContext }) => {
  if (!securityContext.role) {
    throw new Error("No role found in Security Context!")
  }
  if (securityContext.role == "manager") {
    query.filters.push({
      member: "orders.status", operator: "equals",
      values: ["shipped", "completed"]
    })
  }
  if (securityContext.role == "operator") {
    query.filters.push({
      member: "orders.status", operator: "equals",
      values: ["processing"]
    })
  }
  return query
}
```

**3. 按列/关系强制访问**（供应商按 email 只看自己的产品；先从查询成员解析出涉及的 cube）：

```javascript
queryRewrite: (query, { securityContext }) => {
  const cubeNames = [...(query.dimensions || []), ...(query.measures || [])]
    .map((e) => e.split(".")[0])

  if (cubeNames.includes("products")) {
    if (!securityContext.email) {
      throw new Error("No email found in Security Context!")
    }
    query.filters.push({
      member: `suppliers.email`, operator: "equals",
      values: [securityContext.email]
    })
  }
  return query
}
```

**4. 控制 cube/view 可见性**（`extend_context` 派生标志 + `COMPILE_CONTEXT` 控制 `public`）：

```yaml
views:
  - name: total_revenue_per_customer
    public: {{ COMPILE_CONTEXT['securityContext']['isFinance'] }}
```

```javascript
view(`total_revenue_per_customer`, {
  public: COMPILE_CONTEXT.securityContext.isFinance,
})
```

---

## 要点速记

1. **默认全 public**：行、成员、cube、view 默认全开放，安全靠策略收窄。
2. **access_policy 是首选**：声明式、写在模型文件里，同时管成员级 + 行级 + 脱敏；为特定组定义策略后其他组自动拒绝。
3. **参数分工**：`group`/`groups` 定作用组；`conditions` 定生效前提（`if` 全 true，YAML 中是 Python 表达式）；`member_level` 定能看什么（includes/excludes/`"*"`）；`row_level` 定能看哪些行（member/operator/values，REST API 同款格式）；`member_masking` 定脱敏（须与 member_level 同策略）。
4. **二维权限空间**：成员取并集，行在跨成员查询时取交集；拒绝 = 无任何策略授予。
5. **完全访问优先于脱敏**；条件脱敏生成 `CASE WHEN`，聚合度量需过滤成员进 `GROUP BY` 才能条件显示。
6. **query_rewrite 是程序化兜底**：与行级策略组合（AND 生效），适合强制过滤、角色/列级控制。
7. **Cloud 用 `userAttributes`/自动组映射；Core 用 `securityContext` + `context_to_groups`**。
8. **多租户/动态模型**：`context_to_app_id` + `COMPILE_CONTEXT`（注意 `cubeCloud` 为保留元素）。
