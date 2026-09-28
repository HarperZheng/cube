# 问数示范案例：可疑票据（2026-09-22 实测）

> 一次完整问答的长相：查询计划表 → query → 结果 → 口径声明 → qa-log。
> 用户问题："不同单位当前的可疑票据种类和数量"
> 本例 query 一次通过（8 组 < limit）、非金额 count——第4步核验、第5步对数
> 均未触发，两节仅给"长相"供对照。

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

## 第2步组装的 query

```json
{
  "measures":    ["suspicious.suspicious_count"],
  "dimensions":  ["suspicious.agen_name", "suspicious.bill_name"],
  "filters":     [{"member": "suspicious.result", "operator": "equals", "values": ["0"]}],
  "order":       {"suspicious.suspicious_count": "desc"},
  "limit":       100
}
```

## 第3步执行（真实返回节选，8 组 < limit 100，无截断）

| 单位名称 | 票据种类 | 可疑票据数 |
|---|---|---|
| 云南医保测试单位改名 | 云南省医疗门诊收费票据 | 10021 |
| 云南医保测试单位改名 | 云南省医疗住院收费票据 | 2272 |
| 云南考试院测试0615 | 测试-云南省政府非税收入统一票据（电子） | 1544 |

## 第4步核验（未触发——query 一次通过；meta 长相供失败诊断对照）

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

触发时（报错才进）：计划表成员逐个对照 meta 输出，全部出现 → 重查放行。

## 第5步高风险对数（未触发——count 非金额）

涉及金额度量（total_amt 等）/ 对外汇报 / 数字写入文档才触发：db.js 直查
Oracle 对数一条，通过 → 答案标注"已与 Oracle 对数一致"（桥通道 answer
payload 加 `"audited": true`，前端 foot 徽标）；不一致 → 停下报告，不得交付。

## 第6步答案（口径声明长这样）

> 当前（按"处理结果 = 可疑中、未解除"口径）可疑票据按单位、票种分布
> 如上，共 8 组。头部集中：云南医保测试单位改名门诊+住院合计 1.2 万+，
> 占绝对大头。……
>
> 口径说明：「当前」= FRESULT='0'（可疑中）；若您要问"还没处理完的"
> （未通知+待说明），口径不同，数字会变化，可以再查。

若要给占比：**不能**用这 8 行算（万一是截断的）——补一条不带
dimensions 的 count 查询拿全量再算。

## qa-log 落盘行（第6步产物，桥派生）

日志由**桥从最终三态 JSON 机械派生**（14 号日志规格 §4.1 R3 桥单写）——**agent 零动作，
不要自己追加**；plan/tables[].query/assumption/truncated/rows 全是契约字段现成值的转录，
time 由桥打（+08:00）。本例落盘行长这样：

```json
{"time":"2026-09-28T11:30:00+08:00","question":"不同单位当前的可疑票据种类和数量","cube":"suspicious","plan":[["不同单位","suspicious.agen_name","ai_context"],["票据种类","suspicious.bill_name","ai_context"],["数量","suspicious.suspicious_count","ai_context"],["当前","filter suspicious.result=0","口径词典"]],"queries":[{"measures":["suspicious.suspicious_count"],"dimensions":["suspicious.agen_name","suspicious.bill_name"],"filters":[{"member":"suspicious.result","operator":"equals","values":["0"]}],"order":{"suspicious.suspicious_count":"desc"},"limit":100}],"query":{"measures":["suspicious.suspicious_count"],"dimensions":["suspicious.agen_name","suspicious.bill_name"],"filters":[{"member":"suspicious.result","operator":"equals","values":["0"]}],"order":{"suspicious.suspicious_count":"desc"},"limit":100},"assumption":"当前=result 0（口径词典）","truncated":false,"rows":8,"source":"ui"}
```

`queries` = 各表 query 一条一表（单口径长度 1）；`query` 记首表（过渡兼容，读侧迁 queries 后删除）。
