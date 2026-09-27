# data-qa-agent 财政非税收入票据系统 Cube 建模方案

> 状态：**P0-P6 八个阶段全部完成**（2026-09-24，六组回归基线全部通过，见 §10 交付物）；剩余为显式后置项，按需触发（日结族建模、schema_version 自动重编译、生产安全加固等）
> 参考：`D:\develop\cube\docs\01-cube.md ~ 09-context-variables.md`（Cube 概念中文说明）
> 业务来源：`D:\公司\博思\Boss-Code\gitlab\data-qa-agent\data\skills\data-analysis-topic`（8 个主题 SKILL）

---

## 1. 背景与目标

data-qa-agent 现有指标体系基于 **YAML 指标定义 + 变量占位符 SQL 模板**（6 步协议：问题分解 → indicator_search → indicator_implement → 组装 Voucher 报文 → http_request 下发省侧 → display_visualization）。本方案将指标体系迁移到 **Cube 语义层**：

| 现有体系 | Cube 对应物 |
|---|---|
| 指标 YAML（impl/common.yml） | cube 的 measures + dimensions |
| sql_presets（total/by_region/by_agency/by_month） | dimension 的自定义 granularities + view 成员组织 |
| `{t.frgncode#in#getUserRegionCode()}` 行权限占位符 | **access_policy 行级安全**（决策 2） |
| 各状态口径分开写多个指标 | **每个口径单独 measure**（决策 1） |
| 同比/累计指标 SQL 模板 | **time_shift + rolling_window**（决策 4） |
| une_cbill_item 按月分表 | **Jinja + Python 动态枚举 UNION ALL**（决策 3，方案 B） |
| compound_metrics / field_mappings | view 级派生 measure（multi_stage）/ value_mappings → case 维度 |

## 2. 数据源与环境

> 依据：`dataqa-agent-server/src/main/resources/application-oracle.yml`（oracle profile）+ `D:\develop\cube` 现有部署配置

- 数据源：**Oracle 11g R2 及以上**，`jdbc:oracle:thin@//172.18.163.68:1521/orcl`，用户 `YN0411`——与 dataqa-agent-server oracle profile 的应用主数据源**同实例同 schema**
- 应用侧 oracle profile 只切换应用存储库和本地元数据中心，`app.datasources` 业务数据源配置仍独立生效；Cube 侧连接配置在 `D:\develop\cube\.env`（`CUBEJS_DB_*`，`CUBEJS_DB_TYPE=oracle`）
- Cube 镜像为自建 `cube-oracle:local`（见 Dockerfile）：`cubejs/cube` + Oracle Instant Client 19.32 + `preload.js`（oracledb thick 模式强制、11g 分页 ROWNUM 改写、tablesSchema 加速补丁）
- 单数据源：所有同库 join 直接在标准 join/rollup 中完成，**不需要** `rollup_join`；cube 无需显式 `data_source`
- 部署 Docker 网络固定用 `192.168.220.0/24`（避开公司内网 172.18.0.0/16 冲突，保证容器可达内网 Oracle 172.18.163.68）
- 动态模型方案 B 的编译期查表：Oracle 用 `user_tables`（而非 `information_schema`），见第 6 节

## 3. 总体架构

**19 个 cube（5 维度 + 14 事实；P2-P4.5 五个阶段核实后逐步收敛定型；/v1/meta 含存量 bill_kpi/fab_bill 合计 21）+ 6 个 view + 2 个 view-group**

```
┌─ view_groups ─────────────────────────────────────────┐
│  fiscal_payment 财政缴款          ticket_mgmt 票据管理  │
└──────┬───────────────────────────┬────────────────────┘
       │                           │
  views (6)                   views (部分共用)
  paybook 缴款书               ticket_outbound 领票
  ticket_usage 用票            writeoff 审验
  agen_management 单位管理     ticket_supervision 票据监管
       │
  cubes: 事实层 ←→ 维度层（join）
```

## 4. 维度 cube（5 个）

全部 `sql_table` 直连维度表，`public: false`（只通过 join 被事实 cube 引用，不单独暴露）。

| cube | 源表 | 主键 | 关键维度 | 说明 |
|---|---|---|---|---|
| `region` | `afa_auth_region` | `fcode` | name、parent_code、level | 区划；自定义 granularity 支撑 by_region |
| `agency` | `fab_agen` | `fagenidcode` | name、type（case 维度：促进会/联合会/协会/商会 关键词分类）、industry（join `afa_res_dictitem`，fdictcode='117'）、region_code | 单位；`fisfinal='1'` 过滤最新快照 |
| `bill_type` | `fab_bill` | `fcode` | name、category | 票种 |
| `item` | `fab_item` | `fcode` | name、subject_code | 收费项目 |
| `subject` | `fab_subject` | `fcode` | name、parent_code | 收费科目 |

## 5. 事实 cube（14 个，P4.5 新增审验 3 个）

| cube | 源表 | 主题 | 关键 measures（每口径单独） | joins |
|---|---|---|---|---|
| `paybook` | `UNE_PAYBOOK`（**P2 核实修订**：原设计的 une_paybook_new/high 与 fne_paybook_full_high 三表 Oracle 均不存在（0 行），实际缴款书主表为 UNE_PAYBOOK（通知书，7255 行，含 FSTATE），单表无按月分表；FNE_PAYBOOK（631 行）无 FSTATE 非口径源，FNE_QRY_PAYBOOK（1158 行）为查询表） | 缴款书 | count、total_amount、avg_amount；按 fstate 拆分：pending_count(1=待缴款)、paid_count(3=已缴款)、void_count(2=作废)、expired_count(待缴款且 feffdate<today，含 SYSDATE 不参与预聚合命中)；按 fbusinesstype：direct_pay_amt(1=直缴)、collect_pay_amt(2=汇缴) | agency、region |
| `cbill` | `UNE_CBILL`（**P3 核实**：按月分表 UNE_CBILL_YYYYMM 共 48 张，202302~202609 有数（44 个月 32317 行，FID 跨月唯一）；列数不齐 104/105/106——UNION 走 `monthly_columns()` 列交集；口径 FSTATE 1正常 31591/2作废 726，FBUSTYPE 1常规/2电子转纸质/3冲销/4直缴转开票） | 用票 | receipt_count（countDistinct fid 去重）、total_amount、avg_amount；normal/void_count；income_amt；regular/ebill_paper/offset/direct_transfer_amt；宏生成 amt_*_to_date（短名避 11g 30 字符上限） | agency、bill_type |
| `cbill_item` | **动态 UNION ALL**（方案 B，P0 已完成） | 用票明细 | count、item_count、amount | **cbill（belongs_to，FPID=FID，单票下钻）**；agency/item 未声明（join 只声明需要的，02 约定第 6 条）；维度 bill_month（从表名提取） |

> **命名与表名勘误（P0 核查）**：① `une_cbill_new`/`une_cbill_high` 是 ClickHouse 侧指标 YAML 的表名，**Oracle 中不存在**——Oracle 侧开票主表为 `UNE_CBILL`（注释"电脑票"，含状态 FSTATE 1正常/2作废、业务类型 FBUSTYPE 常规开票/冲销/直缴转开票等），明细为 `UNE_CBILL_ITEM`（FPID 关联主表 FID），两者同样有按月分表。② cube 面向消费方用业务语言"**开票**"，源系统内部叫法"电脑票"不出现在 title/描述（P0 已将 cbill_item 标题从"电脑票明细"改为"开票明细"）。P3 建 cbill cube 时以 Oracle 实际表为准（UNE_CBILL 月表是否走动态 UNION 同方案 B）。③ **cbill_high 已正式删除**（une_cbill_high Oracle 不存在）：含项目/不含项目两口径由 `cbill`（receipt_count，count fid 去重）+ `cbill_item`（item_count，count FPID 不去重）承担。④ paybook 家族三表 P2 先 db.js 核实存在性与口径差异再定 cube 数量（冗余副本 → 只建 1 个；多表同口径 → `extends` 复用）。⑤ `expired_count` 的过滤器含 SYSDATE，**不参与预聚合命中**（预聚合按固定过滤值匹配），description 中写明，P6 回归时不误判为预聚合缺陷。
| `stock_out` | `UBE_STOCK_OUT`（**P4 核实勘误**：设计写的 fbe_stock_out 在 Oracle 不存在，实际为 UBE_STOCK_OUT（出库，992 行）；FID 100% 唯一；FCHANGESTATE 61=870/2=104/4=14/1=4 存在复合码；主表无金额列/FBILLID——金额与票种在明细）+ `stock_out_item`（1381 行，FPID 全匹配） | 领票出库 | out_count、明细 total_amount/total_number（明细粒度金额走明细 cube） | agency + 双向 join 明细（cbill/cbill_item 模式） |
| `stock_in` | `UBE_STOCK_IN`（**P4 核实勘误**：fbe_stock_in 不存在，实际 UBE_STOCK_IN（413 行）；**无状态字段**）+ `stock_in_item`（550 行，FPID 全匹配） | 领票入库 | in_count、明细 total_amount/total_number | agency + 双向 join 明细 |
| `stock_apply` | `UBE_STOCK_APPLY`（201 行；FCHANGESTATE 64=141/4=17/31=22/1=5/2=6/541=9/521=1 复合码；FLINKTEL/FLINKADDR 不建维度）+ `stock_apply_item`（237 行） | 领用申请 | apply_count、approve_count('1')、rejected_count('2')、明细 appr_num | agency + 双向 join 明细。**P4 核实**：UBE_STOCK_RECEIVEAPPLY（30 行）全部是 APPLY 同一单的接收副本（FAPPLYID 100% 命中），不建 cube 避免重复计数 |
| `stock` | `V_UBR_STOCK`（库存视图，488 段，7 列无 FID）+ `UBR_STOCK_OFFLINE`（190 段）——3 列键零重叠，UNION ALL + 5 列键拼接合成主键（Cube 有 join 必须有主键；拼接键 488=488/190=190 全唯一实测） | 库存 | stock_count（区划×单位×票据段粒度） | agency、bill_type（FBILLID 2/678 不匹配为数据毛刺） |
| `suspicious` | `FBE_SUSPICIOUS`（**P4 核实定案**：自含完整状态流转 FSTATUS 0未通知=19067/1待说明=88/3已处理=39 + FRESULT 0可疑中/1解除可疑/3（实测有3无2字典外取值），**只建 suspicious 一个 cube**；FBE_RECTIFY_NOTICE（1 行）/FBE_RECTIFY_SUSPICIOUS（4 行）几乎空表无口径价值不建，未来有数据再补；FRGNID 是 GUID——sql 内 LEFT JOIN AFA_AUTH_REGION 翻译出 REGION_CODE（N:1 无行倍增），行级权限走翻译后 region_code；payer_name 脱敏 mask） | 监管 | suspicious_count、pending_count（IN('0','1')）、processed_count（'3'）、cleared_count（FRESULT='1'）、total_amt（8807 亿，未通知占绝大部分） | agency、region、bill_type（三者 100% 匹配已验证） |
| `writeoff` | `FBE_WRITEOFF`（**P4.5 核实定案**：设计原"ticket_cuv 领用核 / ticket_verification 核票"两 view 的实际落点，Oracle 实际主题为**票据审验**，"核销"只是 FWRITEOFFTYPE 属性列；333 行，FID 主键，FRGNCODE 区划直接存在（行级权限与 paybook 同款）；FCHANGESTATE 0=1/1=2/2=330（注释只写 1/2，实测有 0）、FCHECKRESULT 1 良好=264/2 合格=66/null=3（注释写 1/2/3/4，实测只有 1/2/null）；敏感 FLINKTEL/FLINKMOBILENO/FLINKMAN 不建维度；FBILLTOTAL/FBILLCOUNT 是 VARCHAR2 只留维度不建 sum） | 审验 | writeoff_count、audited_count（'2'）、unaudited_count（'1'）、good_count（'1' 良好）、qualified_count（'2' 合格）、payable_amt/real_amt/owe_amt | agency + 反向 one_to_many writeoff_income/writeoff_billitem（下钻，与 cbill 同款） |
| `writeoff_income` | `FBE_WRITEOFF_INCOME`（审验收入明细，2044 行；FPID→主表 FID 281/296 distinct 命中 95%，孤儿 284 行集中在 15 个"保险业务监管费"FPID（数据毛刺）；FITEMIDCODE→FAB_ITEM 100%，维度侧组合键 P1 规则） | 审验明细 | count、item_amt（实收）、payable_amt（应缴）、paid_amt（已缴）、unpaid_amt（未缴） | **writeoff（belongs_to，FPID=FID）**；无区划列，行级权限经主表策略交集（docs/11） |
| `writeoff_billitem` | `FBE_WRITEOFF_BILLITEM`（审验票据开具明细，2230 行；FPID→主表 314 distinct，孤儿 151 行同毛刺；FBILLID→FAB_BILL.FID 100% 匹配） | 审验明细 | count、inv_num（开票份数）、face_amt（票面金额） | **writeoff（belongs_to）**；同上无区划列 |

> **P4.5 不建的表**：FBE_WRITEOFF_BILLSUMMARY（开票汇总 1046，与 BILLITEM 粒度差异待需求）、BILLBALANCE/BILLINVALID（冲销/作废汇总+明细）、RECORD/RESULT（检查记录/结果 73/355）、KEYWORD（字典 8 行）、PRT_SETTING（打印设置）、AGEN_BILLITEM（0 空表）——未来有指标需求再补。UNR_DAILY_*（日结族，UNR_DAILY_WRITEOFF 1650 行 FAGENIDCODE 100% 匹配）为独立主题暂缓建模。
> **主题名称易混淆**：writeoff 审验主题在库内有 7 个中文叫法（审验/检查/核销/冲销/审核/抽验/整改），且表前缀 WRITEOFF 与业务名"审验"错位——同义词地图与问数消歧规则见 [10-易混淆主题名称.md](./10-易混淆主题名称.md)。

### 主子表处理原则

主表（如 `fbe_stock_out`）与明细表（`_item`）是 1:N。**先各自建 cube，主表 count 用主键，不预 join 明细**；需要明细粒度的指标（如按项目汇总出票量）走 `cbill_item`/明细 cube。避免在 cube `sql` 里写 JOIN 导致行倍增——join 关系交给 Cube（见 docs/05-joins.md chasm/fan trap）。概念说明（含 cbill/cbill_item 对比）见 [06-主表与明细表cube概念说明.md](./06-主表与明细表cube概念说明.md)。

**主表明细下钻（P3 定案，依据 docs/05/07/02-measures）**：主表↔明细各声明一条**有向 join**，组成一对边（方向相反，无多路径歧义）：

```yaml
# cbill_item.yml（明细侧，belongs_to 主表）——核心
joins:
  - name: cbill
    sql: "{CUBE}.\"FPID\" = {cbill}.\"FID\""
    relationship: many_to_one

# cbill.yml（主表侧，反向 one_to_many）——供 drill_members 原生下钻
joins:
  - name: cbill_item
    sql: "{CUBE}.\"FID\" = {cbill_item}.\"FPID\""
    relationship: one_to_many
measures:
  - name: receipt_count
    drill_members: [cbill.bill_no, cbill_item.item_name, cbill_item.item_code]
```

| 机制 | 作用 |
|---|---|
| 明细侧 belongs_to | **维度向下传**：明细可达主表全部属性（bill_no/state/bus_type/payer_name）。单票下钻一条查询完成（按 `cbill.bill_no` 过滤 + 明细分组）；"作废票分项目分布"类"按主表属性分析明细"一并解决 |
| 主表侧 one_to_many + drill_members | **原生下钻声明**（docs/02-measures：drill_members 可含 join cube 维度），供前端（Playground/BI）消费。**Core 无 `/v1/drill` 端点**（实测 Cannot POST），REST 侧兜底仍是两步查询模式 |
| 安全性 | FID 主键跨月唯一（32317=32317）+ Cube 靠主键处理 fan trap（docs/05）；行级权限跨成员取交集（docs/11），两 cube region 规则一致行为正确 |

实测：单票下钻（票号 0000000003 → 8 明细行，含负数冲销金额）、作废票分项目分布均出数；cbill/paybook 基线 diff 零差异。P4 主子表（stock_out 等）沿用此模式。

## 6. 动态数据模型方案 B（cbill_item 按月分表）

> sql 的执行过程（编译期 Jinja 展开 → 语义层包裹 → 11g 驱动改写 → Oracle 谓词下推）
> 与 sql_table vs sql 的分工，见 [07-开票数据按月分表说明.md](./07-开票数据按月分表说明.md)。
> P0-P4 建模方法论（核实→构造→验证全流程回顾）见 [09-cube建模总结(p0-p4).md](./09-cube建模总结(p0-p4).md)。

### 6.1 Python 侧（conf/model/globals.py）

Cube 约定 Jinja 可调用函数注册在 `model/globals.py`（挂载后即容器内 `/cube/conf/model/globals.py`）。查表用 Python 的 `oracledb`（thin 模式，无需 Instant Client，连接参数直接读 `.env` 环境变量）：

```python
# conf/model/globals.py
import os
import oracledb          # requirements.txt 声明，Cube 启动时自动 pip 安装
from cube import TemplateContext

template = TemplateContext()

@template.function('cbill_item_tables')
def cbill_item_tables():
    # 编译期查 user_tables（Oracle），返回按月排序的表名列表
    conn = oracledb.connect(
        user=os.environ['CUBEJS_DB_USER'],
        password=os.environ['CUBEJS_DB_PASS'],
        dsn=f"{os.environ['CUBEJS_DB_HOST']}:{os.environ['CUBEJS_DB_PORT']}/{os.environ['CUBEJS_DB_NAME']}",
    )
    try:
        cur = conn.execute(
            "select table_name from user_tables "
            "where table_name like 'UNE_CBILL_ITEM_%' order by table_name")
        return [r[0] for r in cur]
    finally:
        conn.close()
```

### 6.2 YAML 侧（conf/model/cubes/facts_cbill/cbill_item.yml）

```yaml
cubes:
  - name: cbill_item
    sql: |
      {%- set tables = cbill_item_tables() %}
      {%- for t in tables %}
      SELECT {{ t | safe }}.*, substr({{ t | safe }}, -6, 4) || '-'
             || substr({{ t | safe }}, -2, 2) AS bill_month
      FROM {{ t | safe }}
      {%- if not loop.last %} UNION ALL {% endif %}
      {%- endfor %}
```

### 6.3 关键点（P0 实测修订）

1. **`safe` 过滤器必须加（已踩坑）**：Jinja 插值默认 JSON 转义加引号——实测 `{{ ym[:4] }}` 未加 safe 渲染成 `"2023"`（带引号），TO_DATE 拿到非法串报 ORA-01841；**所有拼进 SQL 的插值都要加 safe**，含内联拼接时整段加（`{{ (ym[:4] ~ '-' ~ ym[4:] ~ '-01') | safe }}`）
2. **源库分表实况（55 张匹配，需正则收紧）**：除按月分表 `UNE_CBILL_ITEM_202301..202612`（42 张，含未来月份空表）外，还有干扰表——`UNE_CBILL_ITEM`（主表）、`_BACK3040`（备份）、`_TMP/_TEMP/_DAY_TMP`（临时）、`UNE_CBILL_ITEM_20260807`（**按日分表，8 位日期**）。枚举必须用 `REGEXP_LIKE(table_name, '^UNE_CBILL_ITEM_[0-9]{6}$')`，不能用 LIKE
3. **重编译时机**：容器已设 `CUBEJS_DEV_MODE=true`，conf/ 目录挂载进容器，**模型文件变更自动重编译**（实测保存 globals.py/cbill_item.yml 后数秒内生效）；但新增月份表没有文件变更，需以下之一触发：
   - `schema_version` 异步函数（返回 `COUNT(*) FROM user_tables WHERE REGEXP_LIKE(...)`，表数量变化触发重编译）——**P3 已验证：PyO3 桥接（cube.py）不支持**（`ConfigurationException: Unknown configuration property`，且错误打挂容器；server-core 原生支持 JS 配置 cube.js，Node 侧需自连 Oracle 未采用）——见 [04-P3-记录.md](./04-P3-记录.md) §4
   - **兜底（现行方案）：新月份上线时重启容器（`docker compose restart cube`）**
4. **bill_month 从表名提取**为 time 维度（Cube sql 内 `TO_DATE('YYYY-MM-01')`），下游 by_month preset 直接可用；预聚合在 bill_month 上设 `partition_granularity: month`，与物理分表对齐
5. **Python 依赖（P0 实测修订，推翻原假设）**：`cubejs/cube` 基础镜像**无 pip**、**不会自动安装 requirements.txt**——依赖已在 **Dockerfile 固化**（get-pip.py + `pip3 install --break-system-packages oracledb`）。其他实测坑：
   - **`cube` 模块由原生扩展内置提供**（PyO3/libpython3.13），`from cube import TemplateContext` 开箱即用；**不能 pip 安装 PyPI 的 `cube` 包**（是无关包，会遮蔽内置模块）
   - python-oracledb 26.x 用 **snake_case**：`oracledb.init_oracle_client(lib_dir=...)`（不是 `initOracleClient`），且 **`Connection.execute` 已移除**，必须 `conn.cursor().execute(...)`
   - Oracle 11g 服务端必须 **thick 模式**（thin 仅支持 12.1+）：`init_oracle_client` 指向镜像内 Instant Client 19.32
   - **`cube` 包的 `@template.function` 注册 + Jinja 调用链路已实测打通**
6. **P3 泛化 `monthly_tables(prefix)`**：cbill 月表（UNE_CBILL_YYYYMM）与 cbill_item 共用同一枚举函数，前缀作参数；**枚举时按 `ym <= 当前月` 过滤未来空表**（P0 实测枚举含 202610-202612 等未来月份空表，UNION 空分支纯属扫描浪费）；仍用 `REGEXP_LIKE(table_name, '^<PREFIX>_[0-9]{6}$')` 收紧（排除主表/备份/临时/按日分表）

## 7. 权限方案（access_policy 行级安全）

原 SQL 模板中的权限占位符全部迁移：

| 原占位符 | Cube access_policy |
|---|---|
| `{t.frgncode#in#getUserRegionCode()}` | `region_code` 列的 row-level 规则，`getUserRegionCode()` 从 securityContext 注入 |
| `{t.fagenidcode#in#getUserAgencyCode()}` | `agency_code` 列的 row-level 规则，同上 |

原则：

- 权限在 Cube 层统一执行，**查询方（含 AI 代理）无法绕过**——比模板占位符（依赖每条 SQL 手工保留）更安全
- **P2 最终方案：access_policy 双互补策略（声明式，实测四种场景全部通过）**（单策略失败与 query_rewrite 中间方案的完整过程详见 [03-行级权限记录.md](./03-行级权限记录.md)）：
  - 单策略 + conditions 在 Cube Core 中，**未命中条件的请求直接整表拒绝**（生成 `WHERE (1 = 0)`，`rlsAccessDenied`），**不回落默认全行**——"为特定组定义策略后其他组自动被拒绝"是硬语义
  - 解法：**同一 cube 写两条互补条件的策略**——有区划属性走 `row_level` 过滤，无属性走 `conditions: not securityContext.region_code` + `row_level: allow_all` 显式放行。`allow_all` 恰好补上"如同不存在"的空档：

  ```yaml
  access_policy:
    - group: "*"
      conditions:
        - if: "{ securityContext.region_code }"
      row_level:
        filters:
          - member: region_code
            operator: equals
            values: ["{ securityContext.region_code }"]
    - group: "*"
      conditions:
        - if: "{ not securityContext.region_code }"
      row_level:
        allow_all: true
  ```

  - 实测：无 JWT → 7255；JWT(530100) → 30；JWT(530102) → 16；JWT 无 region 属性 → 7255（Playground Security Context 直接验证，无需签 JWT）
  - 曾退到 `query_rewrite`（conf/cube.py 程序化）中间方案，行为正确，后被声明式替代并**连文件一起删除**（无服务器级配置需求，P3 若需 schema_version 异步函数届时按 `server/container.js:178` 重建 `conf/cube.py`）
- **选择声明式的决定性因素**：查询 view 时 cube 行级规则与 view **叠加生效**（docs/11）——P5 建 view 后 access_policy 零改动；query_rewrite 则需维护 view 名匹配集合
- **通用规则（Core 硬语义）**：任何 access_policy 场景下，**每种用户状态必须至少命中一条策略**，否则未命中的用户被整表拒绝
- **敏感字段脱敏（P3 起为事实 cube 标准项，实测语义见 04 记录）**：事实表含个人/账户敏感字段（paybook.payer_name 缴款人名称、cbill 付款账户、stock 票据号码等）。**单独 `mask` 不生效**——脱敏由 access_policy `member_masking` 激活，且**必须与 `member_level` 同一条策略**（member_level 成员→真实值；不在 member_level 但在 member_masking→脱敏值）。`member_level: excludes: [X]` + `member_masking: includes: [X]` → X 对所有人脱敏：

  ```yaml
  dimensions:
    - name: payer_name
      sql: "{CUBE}.\"FPAYERNAME\""
      type: string
      mask:
        sql: "CONCAT('**', SUBSTR({CUBE}.\"FPAYERNAME\", -2))"   # 只露末2字
  access_policy:
    - group: "*"
      member_level:
        excludes: [payer_name]      # 其余成员真实值
      member_masking:
        includes: [payer_name]      # payer_name 对所有人脱敏
      row_level: ...
  ```
  高度敏感字段（手机号/银行账号，如 payer_tel/payer_no）**不建维度**，暴露面最小化。
- **不再使用 FILTER_PARAMS 做权限**（FILTER_PARAMS 只用于谓词下推性能优化，docs/09 最佳实践）

## 8. 时间口径（决策 4：time_shift + rolling_window）

| 指标类型 | Cube 实现 |
|---|---|
| 同比（上年同期） | 三步：基础度量 → 平移度量（`multi_stage: true` + `time_shift: [{ interval: 1 year, type: prior }]`）→ 比值度量 `{current} / NULLIF({prior}, 0)`（docs/12 §4） |
| 环比（上月） | 同上，`time_shift: [{ interval: 1 month, type: prior }]` |
| 年累计 YTD | `rolling_window: { type: to_date, granularity: year }`（旧写法 `trailing: unbounded, to_date: true` 已废弃，docs/02-measures） |
| 滚动 N 天/月 | `rolling_window: { trailing: N day/month }` |
| by_month | dimension 自定义 granularity `month`（或默认 granularities） |
| by_region / by_agency | 通过 join 到 region/agency 维度 cube 的 name 维度 |

注意：
- time_shift 度量**必须同时声明 `multi_stage: true`**（docs/02-measures/12）
- **`time_dimension` 必须显式指定**：省略时 time_shift 对查询中所有时间维度生效、且数组只允许一条配置（docs/12）——paybook/cbill 都有多个时间维度（fill_date/pay_date/confirm_date），不指定会平移错维度
- **查询粒度要与周期一致**（月环比按 month 分组），写进 measure 的 meta.ai_context 供 AI 消费方规避
- 按 to_date 窗口自身粒度分组时窗口值=基础度量（按月分组看 MTD 只是当月值，docs/12 §5）；要看累加效果按更细粒度分组
- 时间维度统一用查询的 timeDimensions 自动时区转换，**不需要** SQL_UTILS.convertTz（docs/09）

## 9. view 与 view-group

### 9.1 views（6 个，每主题一个）

> 为什么需要 view（简单直观、含本项目真实数据举例：字段归属/同名歧义/join 路径钉死/权限叠加）见 [../08-为什么需要view.md](../08-为什么需要view.md)。

每个 view：`join_path` 明确 join 路径（消除歧义）、`includes` 精选成员、`title/description/meta.ai_context` 供 AI 代理发现、`public: true`。view 级派生 measure（如跨 cube 组合）加 `multi_stage: true` 且 sql 只能引用已 include 成员 `{CUBE.member}`。

| view | 基于 cube | 要点 |
|---|---|---|
| `paybook_overview` | paybook, agency, region | 缴款书全口径 + 单位/区划下钻（**P2 修订**：原设计 paybook_high 已删，源表不存在） |
| `ticket_usage_overview` | cbill, cbill_item, agency, bill_type | 含/不含项目两口径并存（cbill 去重 / cbill_item 不去重）；cbill_item 提供 bill_month 明细。**多事实视图（multi-fact view）**：分子分母在两张事实表，由 Tesseract 支持（v1.7.0+ 默认开启，我们 1.7.42 ✓）——业务过滤在 cube 度量级 filters 写一次所有视图复用，比值类派生度量在 view 层定义并 `multi_stage: true`（docs/12 §3） |
| `ticket_outbound_overview` | stock_out, stock_out_item, stock_in, stock_apply, stock, agency | 领票出入库全流程 + 库存（**P4 修订**：原设计未覆盖 stock 库存 cube 与明细 cube） |
| `writeoff_overview` | writeoff, writeoff_income, writeoff_billitem, agency | 票据审验全口径（**P4.5 替代**：原设计 ticket_cuv 领用核 / ticket_verification 核票两 view 引用的 cube 从未存在，Oracle 实际主题为票据审验，`find 核票` 0 个字段） |
| `ticket_supervision_overview` | suspicious, agency | 可疑票据 + 状态/结果口径（**P4 修订**：实际 cube 名为 suspicious，原设计 supervision 从未存在） |
| `agen_management_overview` | agency, region | 单位管理 |

> 视图数量从设计的 7 个收敛为 6 个（原 ticket_cuv + ticket_verification 两幽灵 view 合并为 writeoff_overview 一个）。命名统一用 `*_overview` 后缀（设计原约定，与现有 `bill_kpi_view` 共存无冲突）。

> **P5 两个必守点**：① view `includes: "*"` 时**必须显式 excludes 技术主键**——included 成员不继承 cube 的 `public: false`（docs/07），fid/item_key/agency.id 等逐一排除；② 多路径歧义要用 `join_path` 钉死——如 paybook 直连 region 与经 agency 传递存在两条路径（docs/05：多路径结果可能不可预测），每个 view 的 join_path 写显式；cbill↔cbill_item 双向 join 边成环，view 的 join_path 必须显式写明走哪条边。

### 9.2 view_groups（2 个）

```yaml
view_groups:
  - name: fiscal_payment
    title: 财政缴款
    description: 缴款书、用票相关视图
    includes:
      - paybook_overview
      - ticket_usage_overview
  - name: ticket_mgmt
    title: 票据管理
    description: 领票、审验、监管、单位管理视图
    includes:
      - ticket_outbound_overview
      - writeoff_overview
      - ticket_supervision_overview
      - agen_management_overview
```

通过 `/v1/meta` 返回顶层 `viewGroups`，AI 代理按分组快速发现视图。

## 10. 开发阶段

| 阶段 | 内容 | 交付物 |
|---|---|---|
| **P0 骨架** | 在现有工程内搭目录：globals.py + 动态枚举、requirements.txt（oracledb）、验证 Cube Core 镜像下 Python 动态模型与 schema_version 配置方式 | **已完成**：`cbill_item` 编译通过（Playground/meta 可见），42 张月表 2023-02～2026-09 全量出数；实测坑回填 §6.3（Jinja safe、snake_case API、cube 包内置、依赖固化进 Dockerfile） |
| **P1 维度层** | 5 个维度 cube（含字典 join、组合主键） | **已完成**：5 个维度 cube 编译通过（含 count 度量），传递 join 验证通过（agency.count 按区划分组正常）。实测要点：① FAB_AGEN 必须 FISFINAL=1 过滤（449→336 行，同码去重）；② FAB_ITEM 有 3 个 FITEMIDCODE 被复用（数据毛刺），组合键 (FITEMIDCODE, FITEMCODE) 去重（1431 全唯一），事实侧按组合键关联（202601 实测 155 行 100% 匹配）；③ 行业字典 FDICTCODE='117' FCODE 唯一，LEFT JOIN 嵌在 agency 的 sql_table 内；④ FAB_SUBJECT 按年度存储（2020-2026），year 纳入维度；⑤ cube 必须含 sql 或 sqlTable（漏写编译报错） |
| **P2 缴款主题** | **已完成**：三设计表（une_paybook_new/high、fne_paybook_full_high）Oracle 均不存在（0 行）→ 只建一个 `paybook` cube（源表 UNE_PAYBOOK，7255 行，无需 extends）；`conf/cube.py` query_rewrite 行级权限（access_policy conditions 实测测不过，见 §7）；**收尾即 snap `regress/paybook.baseline.json`（10 查询）** | paybook 全口径 measures 与 db.js 直查一致（状态 3585/979/2691、过期 3217、直缴/汇缴金额）；JWT(530100) 精确收窄 30 行、无 JWT 默认全省 7255；10 查询基线落盘 |
| **P3 用票主题** | **已完成**：cbill / cbill_item（动态 UNION；globals.py 泛化 `monthly_tables(prefix)` + `monthly_columns(prefix)` 列交集；未来空表过滤；FID 跨月唯一核实 32317=32317；敏感字段脱敏 mask；**宏 import 实测通过**（docs/12 §5，详见 [04-P3-记录.md](./04-P3-记录.md)）；schemaVersion 验证结论：**PyO3 桥接不支持**（ConfigurationException，兜底=重启容器））；**收尾即 snap（12 查询）** | 全量口径 vs db.js 一致（32317/31591/726/income_amt）；Generated SQL 45 张有效月表无未来空表；行级权限 cbill/cbill_item JWT 验证通过；脱敏 cbill/paybook 生效；paybook 回归零差异 |
| **P4 票据管理主题** | **已完成**：先核实（db.js）后建模——表名勘误（设计 fbe_stock_* 实际为 UBE_STOCK_*，同 cbill 勘误模式）；UBE_STOCK_RECEIVEAPPLY 全部是 APPLY 同一单的接收副本不建 cube；supervision 拆案定案为只建 `suspicious`（FBE_SUSPICIOUS 自含状态流转，rectify 家族 1/4 行空表不建）；stock 视图无 FID 用 5 列键拼接合成主键；明细 cube（out/in/apply _item）沿用 cbill/cbill_item 双向 join 下钻模式；**收尾即 snap（12 查询，regress/stock.baseline.json）** | 全口径 measures 与 db.js 一致（out 992/in 413/apply 201/stock 678/suspicious 19194、pending 19155/processed 39/cleared 23）；单票下钻（bill_no+date → 明细票种）实测通过；JWT(530100) 行级收窄 suspicious 110/stock_out 23/stock 18 与 db.js 一致、脱敏 ** 生效；`/v1/meta` 18 个 cube |
| **P4.5 审验主题** | **已完成**：01 设计评审发现"ticket_cuv 领用核 / ticket_verification 核票"两 view 引用的 cube 从未存在（`find 核票` 0 个字段），db.js 实测落点为票据审验（FBE_WRITEOFF 家族 15 表有数据）——先核实六件事后建模，建核心三 cube（writeoff 主表 + writeoff_income 收入明细 + writeoff_billitem 票据明细），主子表双向 join 下钻沿用 cbill 模式；**收尾即 snap（12 查询，regress/writeoff.baseline.json）** | 全口径 measures 与 db.js 一致（333/330/2/264/66、金额三项 12381 亿级、income 四金额、billitem inv_num 30261）；单票下钻（124045-23009 → 4 票种）实测通过；JWT(530100) 行级收窄 10 与 db.js 一致；`/v1/meta` 21 个 cube |
| **P5 视图层** | **已完成**：6 views（paybook_view/usage_view/outbound_view/writeoff_view/superv_view/agen_view）+ 2 view_groups + meta.ai_context（join_path 钉死多路径；同名成员冲突用精选规避 / region join 用 prefix；全部 excludes 技术主键与行级权限维度）；**收尾即 snap（7 查询，regress/views.baseline.json）** | `/v1/meta` 返回 6 个 `type: view` 条目（成员 usage_view.receipt_count 形态）与顶层 `viewGroups`（fiscal_payment / ticket_mgmt）；多事实视图实测（usage 两口径并存、outbound 五事实单查询、writeoff 主子表三事实）；JWT(530100) 走 view 收窄 110/1/1 与 db.js 一致（声明式零改动叠加生效）；Playground sidebar Views 可直接按 view 查询 |
| **P6 预聚合与验证** | **已完成（2026-09-23，范围收敛：cbill/cbill_item 两个 cube；实测记录见 [../06-解释预聚合.md](../06-解释预聚合.md)、[../06-解释cubestore.md](../06-解释cubestore.md)）**：rollup + `partition_granularity: month`（bill_month 对齐物理分表）；paybook/stock/suspicious/writeoff 系"按需"暂缓（千行级 latency 收益有限） | 实测修正与发现：①命中字段是 **`usedPreAggregations`**（原设计写 preAggregations，实测不回显命中）；②物化落**内嵌 Cube Store**（镜像自动运行，190 parquet，external: true），44 分区逐月对齐物理分表；③**命中矩阵**：按月/按状态/item 按月命中，按票种（join 维度）不命中（countDistinct × join 维度匹配约束，raw 兜底）、YTD/单票下钻不命中（预期）；④**数据漂移发现**：源数据 32317→32328（P3 后 +11 笔正常票据），diff 全部 delta 精确 +11 证明预聚合忠实，db.js 直查真相一致；⑤**回归**：cbill/views/paybook 基线 re-snap（漂移更新）后零差异，writeoff/bill_kpi 通过，stock 的 queries 文件已从 baseline 反推恢复并 re-snap——**六组基线全部回归通过**（2026-09-23 补齐）；⑥expired_count（SYSDATE）按天漂移不误判；⑦region_code 已纳入 dimensions（JWT 查询可命中）。数据量千行级，latency 收益有限，P6 价值在 diff 一致性证明——已达成 |

**TODO（01 设计开发完成后考虑）**：`/v1/drill` 端点与 Playground Drill Down 交互——开源 Core 无此端点（实测 Cannot POST），drill_members 声明已全部就绪（各主度量 annotation 回显 drillMembers）；补上后 Playground 从"手动组合下钻"升级为"一键下钻"。方案评估（C 自定义前端客户端拼 / A 迁移原生获得 / B 补丁实现端点）见 [08-drill端点与Playground下钻交互.md](./08-drill端点与Playground下钻交互.md)。**2026-09-23 定案**：注入式增强 / 自绘 Modal / 一期仅表格，实施设计见 08 文档第五节（含实测新事实：视图成员 annotation 携带 drillMembers 且反别名回视图命名空间，view 查询零兜底可用）。

### localhost:4000 可见物细说

> 依据官方文档 docs.cube.dev/docs/explore-analyze/playground（Playground）与 reference/configuration（CUBEJS_DEV_MODE）

容器 `CUBEJS_DEV_MODE=true`，4000 端口同时提供 **Playground UI** 与 **REST API**，另有 15432 端口的 **SQL API**（Postgres 协议）。

#### 一、Playground UI（浏览器访问 `/`，免鉴权）

| 区域 | 可见物 | 阶段用途 |
|---|---|---|
| 左侧 sidebar：**Cubes / Views 切换** | 全部 cube/view 列表；点开显示成员——measures/dimensions/hierarchies/folders 分色分图标；悬浮提示显示 title/description；**非 public 成员带锁标志**（但 Playground 仍可查询验证） | P1–P5：核对成员齐全性、title/description/锁标志是否符合预期 |
| 右上角 **Security Context** 按钮 | 切换当前 securityContext，sidebar 成员随权限变化 | **P2 access_policy 验证关键入口**：切换区划/单位上下文，看成员与查询结果是否按行权限收窄 |
| sidebar 搜索栏 | 按 cube/view/成员搜索，点击直接加入查询 | 16 cube 规模下快速定位成员 |
| 查询构建器（Build） | 选 measures/dimensions/segments；成员旁**漏斗图标**加过滤器；Filters 面板支持布尔逻辑（AND/OR/NOT 组合）；**All members / Used members** 切换；**Order** 下拉排序；**Options** 下拉（ungrouped 查询、时区、row limit/offset、总行数） | 每阶段验证 measures 口径与维度分组 |
| 铅笔按钮（粘贴查询） | 粘贴 REST (JSON) / GraphQL 查询直接 Apply（**SQL API 查询不支持粘贴**） | 用原指标系统的查询 JSON 快速复现口径 |
| 查询 tabs | 多查询并存，存浏览器 localStorage，双击可命名 | 缴款/用票/领票多主题并行比对 |
| **Run Query + 查询耗时** | 右上角显示耗时；查询构建器底部 **PreAggregationStatus 组件**常驻显示预聚合状态——命中时 "Query was accelerated with pre-aggregation"（Badge + 文案），未命中时 link 按钮 "Query was not accelerated..." 点击直接打开 **Rollup Designer**；构建进行中进度条显示 pre-aggregation 阶段（bundle 实扫验证，2026-09-23） | **P6 加速入口**：未命中按钮一键进 Rollup Designer |
| **Results / Chart** 标签 | 结果表格（底部行数、分页）+ 图表面板（可视化类型、Pivot 透视、Code 生成前端代码） | 口径核对与展示验证 |
| **Generated SQL** 标签 | Cube 生成（或将执行）的 SQL，含 `?`/`$1` 参数占位符，可 Copy | **P3 关键**：核对 cbill_item 动态 UNION ALL 展开结果、表名枚举是否完整；P1 核对 join 生成的 LEFT JOIN 形态。注意：preload.js 的 11g ROWNUM 改写发生在驱动执行层，此标签显示的是**改写前**语句 |
| **SQL API / REST (JSON) API / GraphQL API** 标签 | 一键复制等价查询定义 | 对接省侧下发接口组装 Voucher 报文时直接复制使用 |

**Core 限制**：**Jinja Preview 在 Cube Core 不可用**（官方文档明确仅 Cube Cloud Data Model editor 支持，Core 无模板渲染预览）——动态模板（cbill_item.yml）的验证方式改为：Generated SQL 标签 + `POST /v1/sql` 接口 + `docker logs cube` 编译错误日志三处交叉核对。

#### 二、REST API（同端口 4000，需 `Authorization: <apiSecret>`）

| 接口 | 返回 | 阶段用途 |
|---|---|---|
| `GET /cubejs-api/v1/meta` | cubes/views/viewGroups 全量（成员、title、description、meta.ai_context） | **P5 验收点**：7 views + 2 viewGroups 全部可发现 |
| `POST /cubejs-api/v1/load` | 查询结果 + `preAggregations` 命中信息 + latency | 各阶段出数验证；P6 验证预聚合命中 |
| `POST /cubejs-api/v1/sql` | 编译后 SQL | P0/P3 动态 UNION 展开验证 |
| `GET /livez`、`/readyz` | 健康检查 + 模型编译状态 | agent/cube.js check 已封装 |

以上均无需手工调 HTTP：`node agent/cube.js meta/query/check/snap/diff` 已封装（apiSecret 从 `docker logs cube` 解析，`agent/cube.js secret` 可打印）。

#### 三、SQL API（15432 端口，Postgres 协议）

SQL 客户端/BI 工具按 Postgres 协议直连 `localhost:15432`，对**语义层**发 SQL（自动翻译为 Oracle 源库 SQL），而非直连源库。**当前 `.env` 未设 `CUBEJS_SQL_PASSWORD`，dev 模式下接受任意凭据**。

#### 四、安全边界（重要，官方文档明确警告）

**dev 模式是认证绕过（authentication bypass）**：

- `CUBEJS_DEV_MODE=true` 强制 `NODE_ENV=development`，关闭 REST/GraphQL API 的 JWT 校验；Playground 端点全部免鉴权
- 任何能访问 4000 端口的人可以：拿到现成 API token、**铸造任意 securityContext 的 token**（即绕过 access_policy 行级安全）、读写数据模型文件和 `.env`
- 当前 `docker-compose.yml` 端口映射 `4000:4000` 默认绑定 `0.0.0.0`，**宿主机所在内网均可直接访问**——此风险在开发环境已知并接受，**docker-compose.yml 保持现状不修改**；开发机在内网的暴露范围需自行知悉
- 上生产时必须：`CUBEJS_DEV_MODE=false` + 配置 JWT 校验 + 设置 `CUBEJS_SQL_PASSWORD`；届时 access_policy 行级安全才真正生效

### 目录结构（与 D:\develop\cube 现有工程协同）

现有工程已运行：Dockerfile（Oracle Instant Client + preload 补丁）、docker-compose.yml（挂载 conf/preload.js/agent）、.env（Oracle 连接）、agent/（CLI 工具）、conf/model/（已有模型）、regress/（回归基线）。**新模型全部落在已挂载的 `conf/model/` 内，不新增任何容器挂载**：

```
D:\develop\cube\
├── Dockerfile                     # 现有：cubejs/cube + Oracle Instant Client + preload.js（不动）
├── docker-compose.yml             # 现有：挂载 ./conf:/cube/conf、./preload.js、./agent；cube-net 192.168.220.0/24（不动）
├── .env                           # 现有：CUBEJS_DB_* Oracle 连接（globals.py 直接读这些变量）
├── preload.js                     # 现有：thick 模式 + 11g 分页改写 + tablesSchema 加速（不动）
├── requirements.txt               # 新增 P0：声明 oracledb（Python thin 模式），Cube 启动时自动 pip 安装
├── agent/
│   ├── cube.js                    # 现有：REST CLI（meta/query/snap/diff），P6 口径回归复用
│   └── db.js                      # 现有：Oracle 探索工具，建模期查表/查列用
├── conf/                          # 已挂载到容器 /cube/conf（rw），文件变更 dev 模式自动重编译
│   └── model/
│       ├── globals.py             # P0 建、P3 泛化：monthly_tables(prefix) + monthly_columns(prefix)
│       ├── macros/                # P3 已建并实测通过：ptd.jinja（to_date 宏，带 title 参数），时间口径度量批量生成
│       ├── cubes/
│       │   ├── bill_kpi.yml       # 现有（保留，与 cube-metric skill 交付对齐）
│       │   ├── fab_bill.yml       # 现有
│       │   ├── dims/              # P1：region/agency/bill_type/item/subject
│       │   ├── facts_paybook/     # P2：paybook（paybook_high/full 已删，源表不存在）
│       │   ├── facts_cbill/       # P3：cbill/cbill_item.yml（Jinja 动态）
│       │   ├── facts_stock/       # P4：stock_out/stock_in/stock_apply/stock/suspicious 系（含 _item 明细）
│       │   └── facts_writeoff/    # P4.5：writeoff/writeoff_income/writeoff_billitem
│       └── views/
│           ├── example_view.yml   # 现有
│           └── …                  # P5：7 个主题 view + view_groups
├── regress/
│   ├── bill_kpi.baseline.json     # 现有：P6 复用 snap/diff 建新基线
│   ├── paybook/cbill/stock/writeoff.baseline.json  # P2-P4.5 收尾即落盘
│   └── …                          # P6：各主题口径回归基线
└── docs/
    ├── 01-cube.md ~ 09-…          # Cube 概念中文说明（已完成）
    └── cube-dataqa-topic/         # 本方案
```

**协同要点**：

1. **零新增挂载**：所有模型文件放 `conf/model/` 内，靠现有 `./conf:/cube/conf` 挂载进容器，`CUBEJS_DEV_MODE=true` 下文件保存即重编译，无需重建镜像
2. **Dockerfile 小幅扩展（P0 实测后）**：基础镜像无 pip、不自动装 requirements.txt，新增一层安装 Python 依赖（get-pip.py + oracledb）；docker-compose.yml 保持不动
3. **schema_version 已验证（P3）**：PyO3 桥接（cube.py）不支持该属性（ConfigurationException 且打挂容器）；现行方案为新月份上线时重启容器，生产需要时按 JS 配置（cwd/cube.js + oracledb）再验证
4. **现有模型共存**：`bill_kpi.yml`/`fab_bill.yml`/`example_view.yml` 保留不动；新主题模型用子目录组织（实测 `cubes/facts_cbill/` 子目录与现有单文件共存无冲突）

## 11. 风险与注意事项

1. **Oracle 11g 兼容性**：cube `sql` 必须返回扁平表（无 GROUP BY）；11g 分页语法问题已由 `preload.js` ROWNUM 改写解决；动态 UNION ALL 用 Oracle `substr`/`||`（无兼容问题）；建模期注意 11g 不支持部分新语法（如 `FETCH FIRST`），cube sql 内避免使用
2. **行倍增**：所有 1:N 关系依赖主键声明，Cube 自动检测 chasm/fan trap；主子表不要预 join
3. **口径漂移**：每个 measure 的 `description` 写明原指标 YAML 来源与口径（fstate 值、是否去重等），P6 复用 `agent/cube.js snap/diff` 与原 SQL 结果比对
4. **count vs count_distinct**：含项目走 `cbill_item`（count FPID 不去重），不含走 `cbill`（count fid 去重）——两个 cube 分开，view 里并存（cbill_high 已删除：une_cbill_high Oracle 不存在）
5. **安全红线沿用**：所有查询仍走省侧下发接口，不直连 jdbsee_query；access_policy 替代占位符后行权限由 Cube 执行，接口报文组装逻辑不变
6. **Oracle 标识符大小写**：Oracle `user_tables` 返回大写表名/列名，动态 UNION ALL 与 `sql_table` 引用均用大写；cube 成员名（cube 层）仍用小写驼峰
7. **不建中位数/百分位度量**（决策记录）：`PERCENTILE_CONT` + `type: number`（docs/12 §1）不进预聚合、避免成员膨胀，分布类需求 `avg_amount` 已覆盖；后续确有偏态分布分析需求再加
