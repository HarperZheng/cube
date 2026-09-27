# 13 解释 Cube Store（预聚合的"影子仓库"）

> 目的：直观、有层次地说明 Cube Store——是什么、架构、数据以什么形态存在哪里、
> 什么时候有用/可删。预聚合本体见 [06-解释预聚合.md](./06-解释预聚合.md)，
> 预聚合规范见 [docs/06-pre-aggregations.md](../06-pre-aggregations.md)。
> 官方文档：https://docs.cube.dev/products/cubestore
> 本项目实测：2026-09-23，P6 阶段。

---

## 一、是什么（一句话定义）

**Cube Store 是 Cube 自研的列式存储引擎（Rust 编写），专门用来存放预聚合表**——
P6 实测里"镜像内自动运行的东西"（日志的 `cubestore::metastore::rocks_store`、
容器内的 `/cube/conf/.cubestore/`、数百个 parquet 文件）。

## 二、为什么需要：预聚合要"住在哪"

预聚合是物化数据，必须有个地方落盘。两个选择：

| 方案 | 问题 |
|---|---|
| 落回源库（Oracle） | 物化表和业务表抢同一个库，聚合扫描拖累业务负载 |
| **专用分析型存储（Cube Store）** | 列式 + 分区 + 追加写，为"聚合查询"这个单一负载专门优化 |

Cube 的答案：**预聚合构建好后从源库抽出、装进 Cube Store；之后的查询不再碰
源库，直接打 Cube Store**。这就是查询计划里 `external: true` 的含义——
查询被路由到外部存储而非 Oracle。

## 三、架构：三个部件（P6 实测全部对上号）

```
┌─ Cube Store（容器内自动运行，独立进程）───────────┐
│  metastore    目录数据（基于 RocksDB）              │
│               → 登记预聚合表、分区、refresh_key     │  ← P6 日志：rocks_store checkpoint
│  cachestore   parquet 数据文件                     │  ← P6 实测：数百个 parquet
│  uploads      构建数据的中转区                      │  ← 构建时先写这里，压平后清空
└──────────────────────────────────────────────────┘
        ▲ 写入（构建）         ▲ 查询（命中）
        │                      │
      Cube server ──构建 SQL──▶ Oracle（只在构建时碰）
```

P6 亲眼看到的流程：
1. 首查触发构建 → **构建 SQL 打 Oracle**（45 表 UNION + GROUP BY）
2. 结果流式写入 Cube Store → parquet（uploads → cachestore）
3. 后续查询命中 → 查询计划显示 44 个分区 parquet 的 UNION——**这个 UNION 发生
   在 Cube Store 内部**（列式扫描，代价极低），而不是 Oracle 上扫 45 张原表

## 四、本项目的实证形态：内嵌模式

`.env` 无任何 `CUBESTORE_*` 配置 → Cube server **自动拉起内嵌 Cube Store**
（同容器、独立进程）。三个值得注意的细节：

1. **数据落在 `conf/` 挂载里**（`/cube/conf/.cubestore/`）——预聚合数据
   **持久化在宿主机** `D:\develop\cube\conf\.cubestore\`，容器重建不丢。
   这是默认路径相对化的结果，不是刻意配置
2. **分区即物化表**：44 个月 = 44 个分区表，`partition_granularity: month`
   在 Cube Store 里就是 44 个物理 parquet 分区——查某月只扫该分区
3. **refresh_key 的作用域是 Cube Store**：invalidate-key（min/max BILL_MONTH）
   查询结果被缓存（`cached: true`），源数据变化 → key 变化 → 受影响分区
   自动重建——scheduled_refresh 默认开启的效果

## 五、和源库的分工（一句话）

**Oracle 是真相之源，Cube Store 是加速之影**：口径、数据、行级权限全部以
Oracle 为准（预聚合构建 SQL 就是从 Oracle 抽的）；Cube Store 只存"聚合结果
的影子"。P6 diff 零差异的重要性就在这里——证明影子和真身完全一致。

## 六、dev_pre_aggregations：schema 与逻辑表

`dev_pre_aggregations` 是预聚合表的 **schema（命名空间）**——`dev_` 前缀来自
dev 模式下 Cube 的 `preAggregationsSchema` 默认值，目的是**开发/生产隔离**
（dev 反复重建不污染生产的 `pre_aggregations`；生产默认无前缀，可配置）。

**逻辑表名的构成**（实测，`usedPreAggregations.targetTableName` / information_schema）：

```
dev_pre_aggregations.cbill_main20230201_2qrsze1t_sdlm0oa1_1lb4hlb
│                     │       │        │
│                     │       │        └─ 随机 hash（防碰撞）
│                     │       └─ 分区起始日（partition_granularity: month）
│                     └─ 预聚合表名 = cube 名 cbill + 预聚合 name main
└─ dev 模式 schema
```

schema 内（实测）：`cbill_main` + 44 分区、`cbill_item_main` + 44 分区，
合计 **528 张逻辑表**。

**为什么查表要带 schema 前缀**：分区表不是顶层表，住在 `dev_pre_aggregations`
里——不带前缀时数据库在默认 schema 找，找不到。标准 SQL 的 schema 限定名语义
（类比 MySQL `mysql.user`、PostgreSQL `myschema.mytable`）。

## 七、物理存储：每张表都有，分两层

| 层 | 位置 | 内容 |
|---|---|---|
| **表数据** | `conf/.cubestore/data/*.parquet` | 每张逻辑表的列式数据；一张表可对应 1 个或多个文件（chunk 态多一个），压平后一表一文件 |
| **映射关系** | `conf/.cubestore/data/metastore/`（RocksDB `.sst`） | 登记逻辑表名 → 物理文件列表；**目录数据，不是表数据** |

**逻辑表名 vs 物理文件名 vs 对照关系**：

| | 内容 |
|---|---|
| **逻辑表名** | `dev_pre_aggregations.cbill_main20260901_q4kalld1_laff55wf_1lb4hl7`（人可读：schema + cube 名 + 预聚合 name + 分区日期 + hash） |
| **物理文件名** | `100-xhcubdet.parquet`（匿名：序号 + 随机串） |
| **对照关系** | 登记在 **metastore**（RocksDB 二进制）里——"这张表的分区数据在哪些文件" |

文件名故意不含表名：chunk 池复用（一个文件曾可服务多张表的部分数据，压平后
一表一文件），逻辑名/物理名分离是数据库标准做法（类比 MySQL `orders` 表 vs
磁盘 `orders.ibd`）。

每个 parquet 文件头是 `PAR1`（Apache Parquet 魔数），
```
100-xhcubdet.parquet    7111 字节   Sep 22 09:23   ← P6 首次构建时写入
1000-xrrdejhr.parquet   5516 字节   Sep 23 04:10   ← scheduled_refresh 重建时写入
```

- **大小**：每个 5-8KB——分区聚合后只剩几十~几百行，列式压缩后极小
- **mtime = 构建时间**：文件时间戳就是分区构建/重建的时间线

**一句话**：information_schema 查出的 528 张表的物理存储就是
`conf/.cubestore/data/` 里那 528 个 PAR1 魔数的 parquet 文件——此刻严格
一表一文件；表名到文件的对照表在 metastore 的 RocksDB 里，文件名本身是
匿名随机串。

## 八、`.cubestore/data` 目录解读（实查）

```
conf/.cubestore/data/                          ← 预聚合数据的家（宿主机持久化）
├── metastore/                 3.0M   ★ACTIVE RocksDB 目录数据
│   ├── 000120.log / 000122.sst       （000*.sst = 排序字符串表，登记表/分区/refresh_key）
│   ├── CURRENT / IDENTITY / LOCK     （RocksDB 元数据指针）
│   └── archive/
├── metastore-<时间戳>/ ×约20   ~10M   ★checkpoint 快照（每次 checkpoint 留一份）
├── metastore-<时间戳>-logs/          （快照的 WAL 日志）
├── cachestore/                1.1M   ★查询服务的 parquet 存储
│   └── archive/
├── cachestore-<时间戳>/        旧代   残留（容器重建时的旧 generation）
├── uploads/                   空     构建中转区（无构建进行时为空）
└── *.parquet                  数百个  ★预聚合数据本体（cbill_main / cbill_item_main 分区）
```

三个要点：
- **parquet = 数据本体**（构建后陆续增长——后续查询触发更多分区构建）
- **metastore = 目录**（哪张表、哪些分区、refresh_key——调试"没命中"类问题的第一现场）
- **时间戳目录 = checkpoint 快照**：Cube Store 自管理保留数量（日志
  `min_snapshots_count = 5`，旧的自动删）

## 九、什么时候有用 / 可删

**有用的 5 个场景**：

| 场景 | 用途 |
|---|---|
| **1. 查询命中预聚合时**（常驻） | 性能收益的物理载体——命中查询扫这些 parquet 而非 Oracle 45 张原表 |
| **2. 容器重建后** | 数据在宿主机挂载里——重启后直接读同一目录，**预聚合立即可用，不用等 ~10 分钟全量重建** |
| **3. 调试预聚合问题** | uploads 空 = 构建没产出；parquet 数量 = 构建进度；metastore 查表名归属 |
| **4. 磁盘监控** | 当前 ~13M；数据量增长后这里是预聚合磁盘占用点（官方建议单预聚合分区数 500-1000 内） |
| **5. scheduled_refresh 机制** | metastore 快照 = refresh_key 的 checkpoint——增量重建受影响分区靠它 |

**可删 / 注意**：

| 项 | 说明 |
|---|---|
| **纯派生数据，全部可重建** | 每一个字节都来自 Oracle。删除整个 `.cubestore/` 不损失任何口径和正确性——代价只是下次查询触发全量重建（实测 ~10 分钟） |
| **不在真相体系里** | `regress/*.baseline.json` 是回归的真相参考，`.cubestore` 是影子——备份/同步 `conf/` 时**不该带上它** |
| **旧 checkpoint/旧代目录** | Cube Store 自己清理（保留最少 5 份快照），不用手动管 |

## 十、实用操作

```bash
# 看构建是否在产出（uploads 有东西 = 构建进行中）
docker exec cube du -sh /cube/conf/.cubestore/data/uploads/

# 看预聚合数据量
docker exec cube du -sh /cube/conf/.cubestore/data/

# 完全重置预聚合（下次查询触发全量重建，~10 分钟）
rm -rf D:/develop/cube/conf/.cubestore
```

### 直连 Cube Store 查 schema（查预聚合的逻辑表结构）（`cubestore` 子命令）

**端口与 SQL 接口**（实测）：3030 = 编排 HTTP（对外无路由，404）；
**13306 = MySQL 协议 SQL 接口**（直连查表用这个）；15432 = Cube 语义层 SQL API；
4000 = REST API。

```bash
# 查 schema 表清单（information_schema）
docker exec cube sh -c "node /cube/agent/cube.js cubestore 'SELECT table_name FROM information_schema.tables LIMIT 10'"

# 直查分区表数据
docker exec cube sh -c "node /cube/agent/cube.js cubestore 'SELECT COUNT(*) AS rows_in_partition FROM dev_pre_aggregations.cbill_main20260901_<hash>'"

# 查 schema 总表数
docker exec cube sh -c "node /cube/agent/cube.js cubestore 'SELECT COUNT(*) AS total_tables FROM information_schema.tables'"
```

实测：schema 内 528 张逻辑表（= 528 个最终 parquet + 88 个重建中 chunk）。

**三层工具对称**：`db.js` 查 Oracle、`cube.js query/sql` 查语义层、
`cubestore` 查 Cube Store——数字对不上时三面互查。

**方言注意（实测踩点）**：Cube Store SQL 方言有限——不支持 `SHOW TABLES`；
`information_schema.tables` 仅 4 字段（table_schema/table_name/build_range_end/seal_at）；
**双引号是标识符不是字符串**（字符串字面量用单引号），`WHERE table_schema = "xxx"`
会报 Schema error。

## 十一、生产形态（顺带）

内嵌模式适合开发；生产上 Cube Store 可**独立部署**（单独容器/集群，
`CUBESTORE_*` 环境变量指向），多个 Cube server 共享一个 Cube Store 集群，
预聚合构建和查询负载分离。现阶段千行级数据 + 内嵌模式完全够用，不需要动。

---

**一句话总结**：Cube Store 之于预聚合，就像物化视图的专用仓库——Cube 把
"算好的数"搬进去，查询在影子上飞，真相仍在 Oracle。`.cubestore/data` 是
这个影子的物理形态：命中时有用、重启时省时、调试时是第一现场，但纯派生、
可随时删除重建，永远不要把它当源数据对待。
