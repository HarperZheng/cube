---
name: cube-modeling
description: Cube 语义层建模与变更：新增 cube/view、加度量/加维度、交付面增成员，验证后交付。触发词：建指标、生成cube、建KPI、cube模型、语义层指标、加维度、加度量、回归验证、指标口径、对接cube。问数走 cube-ask；view 交付面只增不删。
---

# cube-modeling：建模 / 改模型，验证后交付

目标：用户给一个业务口径或变更需求，产出能跑、数字对得上、可交付 API 的 Cube 模型变更。
架构依据：`docs/cube-agent-architecture.md` B 泳道（B1 修改 view、B2 修改已有 cube、
B3 新增 cube/view——B 编号与分支①②③按轻到重一一对应）。

**核心原则：不靠记忆写模型——契约在本文件里，样例在项目里，写错了编译器会报错。
view 交付面只增不删：删 includes 成员 = 消费方立刻查不到，skill 不提供此功能。**

## 动作识别（前置，先于一切 yml 编辑）

**按轻到重的三问阶梯，第一问命中即停**——能轻则轻恰好也是风险最小路径
（① 纯增量；② 动数据语义，diff 是唯一抓手；③ 零存量风险但成本最高）：

| 问（按序，命中即停） | 判据性质 | 分支 |
|---|---|---|
| 成员在 cube 层已存在（查 yml/meta 可证），需求只是可见性/交付？ | 事实检查 | ① 修改 view（只增不删） |
| 口径要新算，但原料表已被已有 cube 承载？ | 业务判断 | ② 修改已有 cube |
| 原料是新的（新事实表 / 新 join 家族）？ | 业务判断 | ③ 新增 cube/view |

- **①② 边界判错自动纠正**：① 的前提"成员已存在"不满足当场落 ②，无损害
  ——事实检查不需要判断表；**②③ 边界判错是静默成功**（②误判成③ = 口径
  双源；③误判成② = join 家族污染），必须有判断表兜底：

| # | 判断点（全"是"走 ②，任一"否"走 ③） |
|---|---|
| 1 | 原料表已被某 cube 声明（sql_table 同表或同 join 家族，看 conf/model/cubes/*.yml） |
| 2 | 口径能在现有度量上组合（calculated measure / extends） |
| 3 | 需求只是已有事实的另一视角，不是新事实 |

  任一判断点不确定 → AskUserQuestion（同 ③-2），不自作主张

- **复合需求按阶梯拆成序列**：如"交付 XX 指标"而成员不存在 = ② 加成员 →
  追加 ① 交付；交付汇报合并为一次（见文末）
- cube-ask 交接的"修可见性/轻扩展/新主题"分别通常落 ①②③，是识别提示，
  仍过阶梯复核——cube-ask 已做过成员核验（读 yml），提示与实查不一致以实查为准
- **识别为 ② 后、动任何 yml 之前，立即 snap 基线**（基线 = 已交付口径的存照；
  改完才 snap 则 diff 无意义）；③ 无存量可拍，交付时建首基线（③-5）

## 公共前置：环境就绪检查（三分支通用）

```bash
docker exec cube sh -c "node /cube/agent/cube.js check"          # Cube API 连通 + 模型编译状态
docker exec cube sh -c "node /cube/agent/db.js count FAB_BILL"   # Oracle 直连 + 有数据
```

- cube.js/db.js 的**唯一维护副本在 `agent/`**（compose 已挂载 `- ./agent:/cube/agent`）；
  skill 不留备份副本，避免两处维护版本漂移
- 若容器没起：`docker compose up -d` 后重试
- apiSecret 固定在 `.env` 的 `CUBEJS_API_SECRET`（env_file 注入容器，重启不变；
  cube.js 优先读 env，取不到才回退 docker logs）

## 第 0 步接力检查（同会话 ask→modeling，2026-09-27 拍板）

> 设计依据：`docs/cube-dataqa-topic/16-问数到补建模的闭环流程.md` §4。
> 同会话先跑过 cube-ask 再转建模时，交接载体 = 会话上下文本身，**不建交接文件**
> （跨会话交接不在本协议范围）。协议只做三件事：命名可复用资产（防重做）、
> 命名必做验证（防漏验）、固定切换硬门（防越权——切换点 1 = 用户拍板，
> ask 的手不许自己升级到建模）。

会话里 ask 已建立的 → 直接继承（"世界事实"）：

| ask 已建立 | modeling 的处理 |
|---|---|
| 模型 yml 已读（成员清单/口径/命名风格） | 免重读，直接 Edit |
| meta 核验结论（哪些成员存在） | 免重跑，动作识别的事实检查凭它定性 |
| 口径词典内容、计划表、用户原话 | 直接引用（增量验收要用原话构造 query） |
| db 探查结论（源表列/空值/对账，若排查时做过） | 带时间戳采信 |

modeling 必须**新做**的（"变更验证"），一个不免：

| 必做 | 为什么不能从 ask 继承 |
|---|---|
| snap 改前基线 | ask 只查不改，从不碰回归——这是第一次有人要动模型 |
| 新成员原料核实（若 ask 没探过源表） | ask 的失败模式 d 只看 yml，看不到源表 |
| 编辑后 check/meta/query/对数/diff | 验证的是"这次改得对不对"，改前结论全部作废 |
| 词典回写 ＋ 基线生长 | 交付物，ask 无此动作 |
| 增量验收（一条 query＋不变量） | 闭环出口，见"增量验收"节 |

一句话：**ask 攒下的"世界事实"全部继承；modeling 的"变更验证"一个不免。**
无接力（纯建模需求会话）→ 本步跳过，照常自查。

## 分支① 修改 view（只增不删）

1. 读 view yml；**前提**：要暴露的成员必须在 cube 层已存在（view 不发明成员，
   与口径词典同构）
2. 加 includes 成员 / 调整 excludes（需用户确认，一般不动）
3. **meta.ai_context 与底层 cube 同步**（2026-09-24 约定，治 ai_context 双份
   维护分叉）：改 view 的 ai_context 时对照底层 cube yml 的 ai_context，同
   一成员的口径表述两处不得分叉（cube-ask 第1步先读 view ai_context，分叉
   会映射到旧语义）；反向同理——分支②改 cube ai_context 时同步 view
4. **不允许删 includes 成员**：删成员 = 消费方（前端/BI/其他 agent）立刻查不到，
   属对下游静默破坏——**skill 不提供此功能**；确需下线成员 → 停下向用户
   说明影响面，由用户在 skill 之外人工决策
5. check 编译 + query 验证（新成员可查；加成员前后总量应不变——确认 join 不翻倍）
6. diff 回归（同分支②）

## 分支② 修改已有 cube（加度量/加维度）

1. **读现有 yml 全文**（现有成员清单、口径、命名风格）——不凭记忆改
2. **改前 snap 基线**（动作识别时已做；若跳过，此处补做后再动 yml）
3. 新成员原料核实：`dist` / `matchkey`（同 ③-1 命令表）
4. 加成员：命名随现有风格（短名、英文小驼峰、11g 30 字符约束）；口径必写
   description / meta.ai_context；**该 cube 有交付 view 时，view 的
   meta.ai_context 同步更新**（镜像约定，见分支①第3步）
5. 三关自检（同 ③-4）+ **diff 回归**：

```bash
docker exec cube sh -c "node /cube/agent/cube.js diff regress/<cube名>.baseline.json -f regress/<cube名>.queries.json"
```

⚠️ 加维度可能引入新 join → 翻倍破坏存量口径，diff 是唯一抓手；
不一致（退出码 1）必须修复后重跑。**编译通过≠数字对，diff 通过才算改完。**

6. 基线生长：新维度/度量组合追加进 `regress/<cube名>.queries.json` 并重新
   snap——不入基线的组合脱离回归保护，下次变更 diff 不到它
7. 口径词典回写：业务词映射有变的（新增口径、双口径分家等）同步
   `.claude/skills/cube-ask/references/口径词典.md`——cube/view/词典
   **三处口径不一致 = 下次问数仍映射旧口径**
8. 增量验收（同会话 ask 接力时必做，见"增量验收"节）

## 分支③ 新增 cube/view（六步）

### ③-1 解析口径，找原料表（db.js，直连 Oracle）

从口径中提取业务关键词，按列名+中文注释搜字段：

```bash
docker exec cube sh -c "node /cube/agent/db.js find 库存"            # → 字段在哪些表
docker exec cube sh -c "node /cube/agent/db.js cols FAB_AGEN_BILL"   # → 表结构+注释+类型
docker exec cube sh -c "node /cube/agent/db.js count FAB_AGEN_BILL"  # → 行数（判断数据量级）
```

关联键和数据质量必须实查，不能猜——核实命令（docs/09 建模总结"核实六件事"）：

```bash
docker exec cube sh -c "node /cube/agent/db.js sql 'select 键, count(*) from 表 group by 键 having count(*)>1'"  # 关联键是否重复
docker exec cube sh -c "node /cube/agent/db.js dist 表 状态列 [日期列]"       # 口径分布：取值+空值+日期范围（原样分组，不猜字典）
docker exec cube sh -c "node /cube/agent/db.js matchkey 表.外键 参照表.键"    # join 键匹配率 total/miss/%（验过才写进 yml）
docker exec cube sh -c "node /cube/agent/db.js grain 明细表 外键 主表 主键"   # 粒度：明细/外键/主表/孤儿（主子表拆分依据）
docker exec cube sh -c "node /cube/agent/db.js fam 前缀 [排除关键词...]"      # 家族批量行数（存在性普查，一条命令替代逐表 count）
```

### ③-2 口径有歧义必须问（AskUserQuestion）

凡是业务假设需要人拍板的，**必须用 AskUserQuestion 给选项**，不自作主张：

- 月均换算（字段注释是"季度用量"，月均 = ÷3 还是直接用？）
- 粒度选择（按单位看还是全区汇总？）
- 关联键选择（识别码还是名称？）
- 已有同名 cube：修改（走分支②）还是新建？

### ③-3 生成 yml

**模板在 skill 的 `templates/` 里，不靠记忆写**：拷贝对应骨架 → 替换占位符 → 落盘。

- 原料层：`templates/cube.yml` → `conf/model/cubes/<短名>.yml`
- 交付面：`templates/view.yml` → `conf/model/views/<短名>_view.yml`
- 落盘前自检：`grep '<' <文件>` 确认无残留占位符

分层原则：cube 层放原料（原子聚合 `public: false`），view 层做交付
（消费方统一从 view 查，用 `excludes` 挡原料成员）。
**view 的 meta.ai_context 与 cube 镜像同步**（同分支①第3步）：新建 view
写 ai_context 时对照 cube yml，两处口径表述一致。
**建完 cube 要不要立即建 view 过判断点**（docs/cube-dataqa-topic/
../08-为什么需要view.md：有消费方吗——无交付需求只建 cube 不建 view，
P4.5 的 BILLSUMMARY/RECORD/RESULT 暂缓是反例）。

### ③-4 三关自检（②③通用，全过才算建好）

```bash
# 关1 编译通过
docker exec cube sh -c "node /cube/agent/cube.js check"
docker exec cube sh -c "node /cube/agent/cube.js meta <cube名>"

# 关2 查询跑通（交付面用 view 成员："<cube>_view.<成员>"）
docker exec cube sh -c "node /cube/agent/cube.js query '{\"measures\":[\"<cube>.<度量>\"],\"dimensions\":[\"<cube>.<维度>\"],\"limit\":5}'"

# 关3 交叉验证：Oracle 直算 vs Cube，数字必须对上
docker exec cube sh -c "node /cube/agent/db.js sql 'SELECT SUM(...) FROM ...'"   # 真相
docker exec cube sh -c "node /cube/agent/cube.js query '...'"                    # Cube 翻译结果
```

编译报错对照：`Unexpected YAML key` → 格式；`ORA-00972` → 名字超长；`ORA-00904` →
sql 引用了子查询没有的列或用了 `{CUBE}.成员` 引用度量；`ORA-00933` → 已被 preload.js 补丁处理，不应出现。

### ③-5 交付时建首基线（硬动作）

新增交付必须同时产出，未来任何修改才有 diff 可言：

1. `regress/<cube名>.queries.json`——覆盖该 cube 已交付的典型组合（粒度汇总、
   常用维度切分），格式 `[{"name":"票据粒度汇总","query":{...}}]`
2. `docker exec cube sh -c "node /cube/agent/cube.js snap regress/<cube名>.baseline.json -f regress/<cube名>.queries.json"`

### ③-6 交付汇报（三分支通用，见文末）

## 建模规则（三分支通用，每条都是踩过的坑）

1. **比值不可加**：先在 `sql_table` 子查询里聚合到**最细粒度**；交付指标用官方
   calculated measure 写法 `sql: "1.0 * {分子度量} / NULLIF({分母度量}, 0)"`——
   `{度量名}` 引用自动展开为聚合表达式，任意维度切分都正确。
   ⚠️ 禁止 `{CUBE}.成员` 形式（渲染成裸列引用报 ORA-00904）；
   11g 若仍报错，回退 raw 写法 `SUM({CUBE}."分子") / NULLIF(SUM({CUBE}."分母"), 0)`（已验证可行）。
2. **Oracle 11g 标识符 30 字符**：Cube 生成的列别名是 `cube名__成员名`，超长报 `ORA-00972`。
   cube 名和成员名都要短（如 `bill_kpi`、`availMonths`）。
3. **字典表同码多行**：join 字典表前先 `GROUP BY 键` 去重（取 `MAX(名称)`），否则行翻倍。
4. **关联键可能为 NULL**：选两边都有的键（如名称优先于识别码），`WHERE 键 IS NOT NULL` 过滤。
5. **粒度用 UNION 驱动**：多表组合的粒度，用各表的 (键组合) UNION 出来驱动，"有A无B"的行不丢失。
6. **中文 title/description 必写**：annotation 会带给前端和 BI，口径即文档。
7. **旧版格式禁止**：顶层只写 `cubes:`（`cube:`/`sql:` 平铺会报 `Unexpected YAML key`）。
8. **public: false 只藏不拦**：`public: false` 让成员从 meta 字段列表消失（Playground/BI 不可见），
   但不带 access_policy/RBAC 时直接 `/load` 查询仍可执行——硬拦截需配置 access_policy。
9. **view 不继承 public**：cube 上 `public: false` 的成员在 view 里会重新可查，
   view 必须显式 `excludes` 才能挡住。

## 技术点速查（完整注释版在 `templates/cube.yml` / `templates/view.yml`）

| 需求 | 官方方案 |
|---|---|
| AI/智能体口径上下文（不暴露 UI） | `meta.ai_context` |
| 同比/环比 | `time_shift` + `multi_stage: true`（需时间维度） |
| 占比/份额（分母忽略查询过滤） | `grain: keep_only` / `filter: { exclude: [...] }` |
| 带条件的度量（如"有库存的单位数"） | measure 级 `filters` |
| 点指标下钻明细 | `drill_members` |
| 粗到细下钻 | `hierarchies` |
| 单位/租户强制隔离 | view 级 `default_filters` |
| 多指标 view 归组（AI/前端发现） | `view_groups` |
| 可加和的去重计数（能进预聚合） | `count_distinct_approx` |
| 同构指标复用 | `extends`（cube/view 均支持） |
| 缓存 | `refresh_key`（默认 10 秒，Oracle 缓存基本无效，设 `every: 1 hour` 需确认延迟） |
| 数据量大 | `pre_aggregations`（original_sql 物化多 join 子查询） |
| 多 cube 联查歧义 | view 明确 join 路径（传递连接多路径结果不可预测） |

## 增量验收（交付终步，2026-09-27 拍板）

> 适用：问数侧发起的补建模（同会话接力）。出口标准是"**原话的答案查询
> 能出、数字对上**"，不是"模型编译过"——16 号文档 §4.3：事故断点正是
> "模型缺列→agent 答不了"，没人验过最后一环。重走五步与三关 4/5 重复
> （meta/组装/执行/对数都做过），验收唯一增量是"原话的答案查询能不能出"
> ——确定性构造一条跑即可，不经重解析。

- **构造**：验收 query = 问阶段主 query ∪ 新增成员——加维度则
  `dimensions += 新维度`、加度量则 `measures += 新度量`；
  measures/filters/order 一律不动。多口径时只扩展"因缺口缺维度"的那条，
  源表本身无列的口径维持原样（验收后原拆分 workaround 自然作废）
- **执行一条**，比对两个不变量：
  ① 合计 == 关3 已对数总额（同表同度量同过滤，分组细化不改总和——
    Oracle 不用再碰）
  ② 组数符合建阶段 db 探查预期（组数逼近 limit 则抬 limit 重跑一次）
- **产出即交付**：这条查询的结果就是原话的验收答案表，不是废测试
- **刻意不验**：原话→词典→新成员的 LLM 解析行为（会话内自审置信度增量≈0），
  交由下次真实提问自然验证（预置上下文零缓存现扫 yml，改完即生效）；
  高风险变更（动 join/口径语义、数字对外汇报）可加测 T2：python urllib
  POST :4100 真问一次（curl 中文 body 踩 GBK 坑，必须用 python）
- 对不上 → 回建模修复重验，**不带病交付**

## 交付汇报（三分支通用）

向用户报告：

1. 口径（公式、单位、业务假设——含 AskUserQuestion 的结论）
2. 数据样例表（真实查询结果，几行）
3. API 用法（curl 示例 + Playground 里对应的维度/度量组合）
4. 注意事项（口径假设、数据质量风险、验证结论）
5. 修改/交付面变更：回归结果；新增：首基线已建
6. 同会话接力变更：增量验收结论（不变量对上情况）＋验收答案表

## 角色分工速记

| | `db.js`（容器内，直连 Oracle） | `cube.js`（容器内，走 Cube API） |
|---|---|---|
| 视角 | 数据库的真相 | 消费方的视角 |
| 用途 | 找表、看结构、验证关联键、算对照数字 | 编译验证、跑查询、回归对比 |
| 阶段 | 建模前（摸原料）+ 建模后（交叉验证） | 建模后（自检 + 回归） |
