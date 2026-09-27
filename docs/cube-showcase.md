# Cube 语义层项目展示：从建模到 API 交付

- **环境**：Oracle 11g（公司内网 `172.18.163.68:1521`）+ Docker 化的 Cube（语义层），Windows 本机
- **业务目标**：财政票据管理系统的「票据申领库存可用时间」等指标，统一口径后对外提供 API
- **完整链路**：Oracle 明细表 → Cube 数据模型（口径定义）→ Playground 自由组合验证 → REST API / 前端交付

---

## 一、整体架构

```
┌─────────────┐     ┌──────────────────────────┐     ┌──────────────────────┐
│  Oracle 11g  │     │       Cube (Docker)       │     │       消费方          │
│  明细表/字典  │ ──► │  数据模型(口径) + 缓存     │ ──► │  Playground 数据探索  │
│  3.6万列     │     │  自动生成 SQL / 11g 兼容   │     │  REST API → 前端/BI  │
└─────────────┘     └──────────────────────────┘     └──────────────────────┘
```

**Cube 解决的核心问题**：口径定义一次（写在conf\model\cubes 的.yml文件），所有消费方（报表、前端、BI）拿到的是**同一个口径**的数字，而不是各自写 SQL 各算各的。

## 二、第一步：构建 Cube Model（以 `bill_kpi` 为例）

契约见：https://docs.cube.dev/docs/data-modeling/overview

### 2.1 模型文件 `conf/model/cubes/bill_kpi.yml`

```yaml
cubes:
  - name: bill_kpi
    title: 票据库存可用时间
    description: 口径：单位票据库存余量(份) / 月均使用量(份/月)
    data_source: default

    # 按票据粒度预先聚合两张明细表，避免跨表 join 后比值不可加的问题
    sql_table: >
      (
        SELECT
          b."FID"        AS "FBILLID",
          b."FBILLCODE"  AS "FBILLCODE",
          b."FBILLNAME"  AS "FBILLNAME",
          NVL(AG."STOCK_SUM", 0) AS "STOCK_SUM",
          NVL(UB."USE_Q", 0)     AS "USE_Q"
        FROM "FAB_BILL" b
        LEFT JOIN (
          SELECT "FBILLID", SUM("FSTOCKCHKNUM") AS "STOCK_SUM"
          FROM "FAB_AGEN_BILL"
          GROUP BY "FBILLID"
        ) AG ON AG."FBILLID" = b."FID"
        LEFT JOIN (
          SELECT "FBILLID", SUM("FINVOICENUM") AS "USE_Q"
          FROM "FAB_AGEN_APPLY_USEBILL"
          GROUP BY "FBILLID"
        ) UB ON UB."FBILLID" = b."FID"
      )

    dimensions:
      - name: fbillid
        title: 票据ID
        sql: "{CUBE}.\"FBILLID\""
        type: string
        primaryKey: true
      - name: fbillcode
        title: 票据编码
        sql: "{CUBE}.\"FBILLCODE\""
        type: string
      - name: fbillname
        title: 票据名称
        sql: "{CUBE}.\"FBILLNAME\""
        type: string

    measures:
      - name: stockSum
        title: 库存余量(份)
        sql: "{CUBE}.\"STOCK_SUM\""
        type: sum

      - name: quarterlyUsage
        title: 季度用量(份)
        sql: "{CUBE}.\"USE_Q\""
        type: sum

      - name: monthlyUsage
        title: 月均使用量(份/月)
        description: 季度用量 / 3
        sql: "{CUBE}.\"USE_Q\" / 3.0"
        type: sum

      # 比值指标：子查询已按票据粒度聚合，这里 SUM 按当前分组实时计算，
      # 保证按任意维度切分（票据/编码等）时比值都正确
      - name: availMonths
        title: 票据申领库存可用时间(月)
        description: 库存余量(份) / 月均使用量(份/月)
        sql: "SUM({CUBE}.\"STOCK_SUM\") / NULLIF(SUM({CUBE}.\"USE_Q\") / 3.0, 0)"
        type: number
```

### 2.2 说明

1. **LLM基于契约生成上述文件**。
2. **比值定义在聚合后的度量上**：`availMonths` 的 sql 是 `SUM(...)/SUM(...)`，Cube 会在
   **当前分组**上实时计算，所以不管按"票据名称"还是"票据编码"切分，比值都是对的。
3. **口径即文档**：`title` / `description` 写中文口径，Playground、REST API 的 `annotation`、
   BI 工具里显示的都是这份口径说明。

---

## 三、Playground 自由组合（数据探索与口径验证）

浏览器打开 `http://localhost:4000` → **Build** 标签 → 选 `bill_kpi`。

- **dimension（维度）**= 按什么看，决定分组：票据名称、票据编码……
- **measure（度量）**= 看什么数字：库存余量、月均用量、可用时间……

每次 Run 就是在问数据一个具体的问题，Cube 翻译成一条 `GROUP BY` SQL：

| Build 里的组合 | 等于在问 | 用途 |
|---|---|---|
| 票据名称 ＋ 可用时间(月) | 每种票据的库存还能撑几个月？ | **核心指标** |
| 票据名称 ＋ 库存余量 | 每种票据各剩多少库存？ | 库存监控 |
| 票据名称 ＋ 月均用量 | 哪些票据消耗得快？ | 使用强度分析 |
| （不选维度）＋ 库存余量 | 全部票据库存总共还剩多少？ | 总量汇总 |
| 加 filter：库存 > 0 | 只对有库存的票据回答上面的问题 | 排除无效行 |

如图是一次随机组合：

![1789891091925](C:\Users\87239\AppData\Roaming\Typora\typora-user-images\1789891091925.png)



**这一步的意义**：

1、快速验证口径是否符合业务预期（如"非税收入一般缴款书可用 272.7 个月"）

2、试探维度是否够用。

3、Build 是实验台，验证通过的组合就是将来对外交付的 API 形态。

4、可以看到新的sql和REST API参数

---

## 四、REST API 请求

### 4.1 获取凭证

dev 模式下 apiSecret 每次重启随机生成：

```bash
docker logs cube | grep "generated it as"
# → Warning. Option apiSecret is required in dev mode. Cube has generated it as 6b977b6e...
```

### 4.2 请求示例

固定的uri：http://localhost:4000/cubejs-api/v1/load

参数是固定结构。

```bash
curl http://localhost:4000/cubejs-api/v1/load \
  -H "Authorization: <apiSecret>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "dimensions": [
        "bill_kpi.fbillcode",
        "bill_kpi.fbillname"
      ],
      "measures": [
        "bill_kpi.monthlyUsage",
        "bill_kpi.quarterlyUsage"
      ]
    }
  }'
```

query 的结构与 Build 里拖的组合**一一对应**：measures、dimensions、filters、order、limit。

### 4.3 真实响应（截取）

| 票据编码 | 票据名称                           | 月均使用量         | 季度用量 |
| -------- | ---------------------------------- | ------------------ | -------- |
| 530301   | 非税收入一般缴款书（机开）（新版） | 14.33333333333333  | 43       |
| 530101   | 非税收入收款收据（单位执收）       | 10.66666666666666  | 32       |
| 530501   | 社会捐赠收据                       | 6.666666666666669  | 20       |
| 530106   | 非税收入退款收据                   | 4.3333333333333295 | 13       |
| 530502   | 社会资金公益事业捐赠票据           | 4                  | 12       |
| 530103   | 非税收入一般缴款书（机开）（新版） | 4                  | 12       |
| 530204   | 罚没物资专用票据（微机）           | 3.66666666666667   | 11       |
| 54020401 | CS003                              | 3.3333333333333295 | 10       |
| 530125   | 医疗门诊电子票                     | 3.3333333333333295 | 10       |
| 540202   | 医疗门诊纸质票                     | 3.3333333333333295 | 10       |
| 530108   | 非税收入定额收据                   | 2.66666666666667   | 8        |



---

## 五、前端接入（简述）

![1789891376284](C:\Users\87239\AppData\Roaming\Typora\typora-user-images\1789891376284.png)

前端用官方 SDK，query 结构与 REST 完全一致：

```jsx
import { useCubeQuery } from '@cubejs-client/react';

function StockTable() {
  const { resultSet, isLoading, error } = useCubeQuery({
    measures: ['bill_kpi.availMonths', 'bill_kpi.stockSum'],
    dimensions: ['bill_kpi.fbillname'],
    filters: [{ member: 'bill_kpi.stockSum', operator: 'gt', values: ['0'] }],
  });
  if (isLoading) return <p>加载中...</p>;
  return <Table rows={resultSet.tableData()} />;   // annotation.title 渲染表头
}
```

BI 工具（帆软 / Metabase 等）则走 **Cube SQL API**：`localhost:15432`（Postgres 协议），
把 Cube 当成一个普通 Postgres 库连接，口径同样由模型保证。

---

## 六、成果总结

| 能力 | 说明 |
|---|---|
| **口径统一** | 指标定义在模型里一次，Playground / REST / 前端 / BI 全部一致 |
| **跨表指标** | 三张表（字典 + 库存 + 用量）聚合为一个语义化的 KPI cube |
| **任意切分正确** | 比值在聚合后度量上实时计算，按任意维度分组都正确 |
| **秒级响应** | Cube 自带查询缓存（refresh_key 机制），重复查询命中缓存 |
| **自文档化 API** | `annotation` 携带中文标题和口径描述，前端直接渲染 |
| **遗留系统兼容** | 通过 preload.js 补丁让 Cube 完整支持 Oracle 11g（分页语法 / 表结构加速） |

**后续规划**：按同样模式接入更多指标（指标 2、3，口径确认后即可）；为 `bill_kpi` 增加
单位/区划维度（子查询粒度升级为"票据×单位"）；生产化时固定 `CUBEJS_API_SECRET` 并启用 JWT 鉴权。
