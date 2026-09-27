# 问数示范案例：可疑票据（2026-09-22 实测）

> 一次完整问答的长相：查询计划表 → query → 结果 → 口径声明 → qa-log。
> 用户问题："不同单位当前的可疑票据种类和数量"

## 第1步产出的查询计划表

| 自然语言 | 成员（cube.member） | 依据 |
|---|---|---|
| 不同单位 | suspicious.agen_name | ai_context：单位名称走 agen_name |
| 票据种类 | suspicious.bill_name | ai_context；bill_id 已 public:false（票种名称走名称维度） |
| 数量 | suspicious.suspicious_count | ai_context：可疑票据数用 suspicious_count |
| 当前 | filter: suspicious.result = '0' | ⚠️ 歧义 → 词典词条"当前"（备选 pending 口径） |

歧义处理过程：读 suspicious.yml 的 ai_context 发现两套状态维度
（FSTATUS 流转 / FRESULT 处理结果）→ 查口径词典，已有"当前"词条
（result='0' 可疑中）→ 直接采用，答案中声明。

## 第2步核验（命令与输出节选）

```
$ docker exec cube sh -c "node /cube/agent/cube.js meta suspicious"
# cube: suspicious  (title: 可疑票据)
  measure   suspicious.count  可疑记录数
  measure   suspicious.suspicious_count  可疑票据数  // count_distinct(FID)（FID 主键，等价 count）
  ...
  dimension suspicious.agen_name  string  单位名称
  dimension suspicious.bill_name  string  票据名称
  dimension suspicious.result  string  处理结果
```

计划表 4 个成员全部出现 → 过 gate。

## 第3步组装的 query

```json
{
  "measures":    ["suspicious.suspicious_count"],
  "dimensions":  ["suspicious.agen_name", "suspicious.bill_name"],
  "filters":     [{"member": "suspicious.result", "operator": "equals", "values": ["0"]}],
  "order":       {"suspicious.suspicious_count": "desc"},
  "limit":       100
}
```

## 第4步执行（真实返回节选，8 组 < limit 100，无截断）

| 单位名称 | 票据种类 | 可疑票据数 |
|---|---|---|
| 云南医保测试单位改名 | 云南省医疗门诊收费票据 | 10021 |
| 云南医保测试单位改名 | 云南省医疗住院收费票据 | 2272 |
| 云南考试院测试0615 | 测试-云南省政府非税收入统一票据（电子） | 1544 |

## 第5步答案（口径声明长这样）

> 当前（按"处理结果 = 可疑中、未解除"口径）可疑票据按单位、票种分布
> 如上，共 8 组。头部集中：云南医保测试单位改名门诊+住院合计 1.2 万+，
> 占绝对大头。……
>
> 口径说明：「当前」= FRESULT='0'（可疑中）；若您要问"还没处理完的"
> （未通知+待说明），口径不同，数字会变化，可以再查。

若要给占比：**不能**用这 8 行算（万一是截断的）——补一条不带
dimensions 的 count 查询拿全量再算。涉及金额（total_amt）或对外汇报
数字 → 先 db.js 对数再交付。

## qa-log 追加行（第5步产物）

```json
{"time":"2026-09-22T11:30:00+08:00","question":"不同单位当前的可疑票据种类和数量","cube":"suspicious","plan":[["不同单位","suspicious.agen_name","ai_context"],["票据种类","suspicious.bill_name","ai_context"],["数量","suspicious.suspicious_count","ai_context"],["当前","filter suspicious.result=0","口径词典"]],"query":{"measures":["suspicious.suspicious_count"],"dimensions":["suspicious.agen_name","suspicious.bill_name"],"filters":[{"member":"suspicious.result","operator":"equals","values":["0"]}],"order":{"suspicious.suspicious_count":"desc"},"limit":100},"assumption":"当前=result 0（口径词典）","truncated":false,"rows":8}
```
