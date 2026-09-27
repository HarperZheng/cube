# Joins（连接）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/joins

## 是什么

Join 定义 **cube 之间的关系**，允许同时访问和比较多个 cube 的成员。在声明 join 的 cube 内使用 `joins` 参数。

## 基本结构

```yaml
cubes:
  - name: orders
    joins:
      - name: customers              # 必须与被 join 的 cube 名一致
        relationship: many_to_one    # 关系类型
        sql: "{CUBE}.customer_id = {customers.id}"   # ON 条件
```

## 关系类型（relationship）

| 类型 | 含义 | 别名（旧写法，仍有效） |
|---|---|---|
| `one_to_one` | 一对一 | `has_one` |
| `one_to_many` | 一对多 | `has_many` |
| `many_to_one` | 多对一 | `belongs_to` |

正确声明关系类型很重要——Cube 依赖它准确计算度量、检测 chasm/fan trap。

## 核心规则

- **所有 join 都生成为 `LEFT JOIN`**：声明 join 的 cube 是主表（左表）。
- `INNER JOIN` 语义可通过额外过滤实现（如 `set` 过滤器检查 `IS NOT NULL`）。
- 不支持 `FULL OUTER JOIN` 和 `RIGHT OUTER JOIN`。RIGHT 语义从另一侧声明 join 即可；FULL OUTER 可写在 cube 的 `sql` 里（数据融合场景建议单独建 cube）。
- join 不需要在两个 cube 上都声明，但声明会影响 join 方向。

## 主键要求（重要）

join 要正常工作，相关 cube **必须定义 `primary_key`**（在 dimensions 中）。Cube 依赖主键自动检测并解决 chasm / fan trap（行倍增）问题：先取被倍增 cube 的 distinct 主键，再 join 回原表聚合。

没有单列主键时可造**复合主键**：

```yaml
dimensions:
  - name: id
    sql: "{CUBE}.user_id || '-' || {CUBE}.signup_week"
    type: string
    primary_key: true
```

## CUBE 引用

多个 cube join 时用 `{CUBE}.column` 引用当前 cube 的列，避免歧义（编译时替换为当前 cube 的别名）。

## 传递连接（transitive joins）

Cube 会自动解析传递连接：`a → b` 和 `b → c` 已定义时，查询 `a.count` by `c.category` 会自动找到 join 路径（Dijkstra 算法）。join 图是**有向的**，`a → b` 不同于 `b → a`。存在多条 join 路径时结果可能不可预测——**应使用 view 明确 join 路径**。
