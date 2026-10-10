# 多数据源（Multiple Data Sources）

> 参考文档：
> - https://docs.cube.dev/admin/connect-to-data/data-sources/index
> - https://docs.cube.dev/admin/connect-to-data/multiple-data-sources
> - https://docs.cube.dev/recipes/data-modeling/cross-data-source-queries

## 是什么

Cube 支持一个部署**同时连接多个数据源**：1 个默认数据源（必须存在，不可删除）+
0..N 个命名数据源。每个 cube 用 `data_source` 属性声明挂在哪个源上，不声明就走默认源。
典型场景：数据按"年龄"分库——近几个月留在快分析库服务实时看板，更早的搬去廉价存储，
两边表同构，需要一起出报表。

## 怎么配置：环境变量

默认源用裸 `CUBEJS_DB_*`，命名源用 `CUBEJS_DS_<NAME>_*` 前缀，
`CUBEJS_DATASOURCES` 列出全部源（default 在前，命名项小写，有命名源时自动维护）：

```bash
CUBEJS_DATASOURCES=default,recent
CUBEJS_DB_TYPE=postgres              # 默认源（归档库）
CUBEJS_DB_HOST=archive.example.com
CUBEJS_DB_NAME=analytics
CUBEJS_DS_RECENT_DB_TYPE=clickhouse  # 命名源 recent（在线库）
CUBEJS_DS_RECENT_DB_HOST=clickhouse.example.com
CUBEJS_DS_RECENT_DB_NAME=analytics
```

- Cube Cloud 入口：Settings → Data Sources（+ Add data source → 选驱动 → 起名 →
  填连接表单，保存前测连接）。UI 本质就是维护上面这批环境变量，也可在
  Settings → Environment Variables 里手工改。
- 删除默认源：UI 里删不掉（只能编辑），要手工清掉裸 `CUBEJS_DB_*` 变量。

### 命名规则

- 只允许字母、数字、下划线，必须字母开头；
- `default` 是保留名；
- 平坦名字（`analytics`、`warehouse`）比带下划线的安全——名字以下划线 +
  `db`/`aws`/`jdbc` 结尾时会和环境变量解析器撞车。

## cube 怎么挂源

```yaml
cubes:
  - name: archived_events
    sql_table: events          # 不写 data_source → 走默认源
    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true
      - name: storage
        sql: "'archive'"       # 常量维度，标识行的来源库
        type: string

  - name: recent_events
    sql_table: events
    data_source: recent        # 挂命名源 recent
    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true
      - name: storage
        sql: "'recent'"
        type: string
```

- 两个 cube 成员面对齐（同名同型），外加一个常量维度标识来源——这是跨源
  UNION 的建模套路（见下节）。
- **view 没有自己的 `data_source` 属性**：view 由 cube 成员组成，每个成员跟随
  所属 cube 的数据源。

## 跨源查询规则（关键限制）

### 跨源不能 join

join 两个不同数据源上的 cube，查询**直接被拒绝**。跨库关联实体（加列）的唯一
出路是 `rollup_join` 预聚合：把一个源的数据物化到另一个源再关联。

（对比：`rollup_join` 加列＝跨库关联；UNION 加行＝跨库拼接；data blending＝
同库内 cube 间的 union。三件事别混。）

### 跨源能 UNION ALL（SQL API）

```sql
SELECT storage, tier, MEASURE(event_count) AS events
FROM archived_events
WHERE tier = 'enterprise'
GROUP BY 1, 2
UNION ALL
SELECT storage, tier, MEASURE(event_count) AS events
FROM recent_events
WHERE tier = 'enterprise'
GROUP BY 1, 2
```

- 每半边下推到自己的库、用该库方言执行，Cube 在顶层拼接结果；
- 过滤器**下推到库**（`WHERE` 是发给该库的请求的一部分，不是事后过滤）；
- 要跨两库再聚合（如按 tier 汇总），把 UNION 包进 CTE 再 SUM——但只对
  可加度量正确（见下）；
- `EXPLAIN` 可看到拆分计划：顶层 Union，每边一个带自己 filter 的 CubeScan。

### 非可加度量不能跨源合并

`count_distinct`、`avg`、分位数这类非可加度量**不能**从各源结果拼出全局值
（distinct 相加重复计数、平均的平均忽略权重），而且**不报错**。这类指标只能
分源上报（正好用 storage 维度分组呈现）。

### 行数上限在拼接前按半边生效

每半边各自受 row limit 约束，上限发生在结果拼接**之前**。所以先在每半边内部
聚合、再 UNION——不要 UNION 原始行后再聚合。

### SQL API 的 pg_ 前缀坑

cube 名以 `pg_` 开头时，SQL API 会把裸名路由进 pg_catalog，报
`Table or CTE with name 'pg_...' not found`——要用 cube 所在 schema 限定
（`FROM public.pg_costs`）或避开该前缀。

## 预聚合独立存储

每个源可以把自己的预聚合建到/存到一条专用连接上：

```bash
CUBEJS_DS_<NAME>_PRE_AGGREGATIONS_DB_HOST=...
# 及同族 _DB_* 变量
```

这也是跨源 `rollup_join` 的基础（把 A 源的 rollup 物化到 B 源的预聚合库）。

## 多租户动态选源

静态多源＝按 cube 固定挂源；如果数据源要**按请求动态决定**（多租户场景），
走 `driver_factory` 按请求上下文返回连接，而不是静态命名源。另可按源调整
查询并发度（Querying concurrency）。

## 关联阅读

- rollup_join 预聚合：https://docs.cube.dev/reference/data-modeling/pre-aggregations
- 预聚合 schema/独立存储：https://docs.cube.dev/reference/configuration
- 查询并发：https://docs.cube.dev/admin/connect-to-data/querying-concurrency
- 多租户 vs 多数据源：https://docs.cube.dev/embedding/multitenancy
- 环境变量总表：https://docs.cube.dev/reference/environment-variables
