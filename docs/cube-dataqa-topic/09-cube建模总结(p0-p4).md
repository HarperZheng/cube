# 09 Cube 建模总结（P0-P4）：核实 → 构造 → 验证

> 用途一句话：**回顾 P0→P4 每个 cube 是怎么落地的**——先核实（db.js 六件事）、
> 再构造（固定七步）、后验证（口径对照 + 权限 + snap 基线）。
> 可压缩成一句话：**先核实后建模，结论落注释，口径必对照，收尾即 snap**。

---

## 一、核实：怎么确认表存在性与口径（建模前）

**核心工具**：`agent/db.js`（容器内跑），9 个子命令覆盖全部核实动作
（基础 5 个 + 核实 4 个，均加前缀 `MSYS_NO_PATHCONV=1`）：

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T cube node /cube/agent/db.js
  tables [前缀]     # 存在性 + 表注释（基础）
  cols <表名>       # 列 + 类型 + 列注释（基础）
  count <表名>      # 行数（基础）
  sql "<select>"    # 任意聚合/关联核实（基础）
  find <关键字>     # 按列名/注释搜字段（基础）
  dist <表> <列> [日期列]              # 口径分布：取值+空值+日期范围（第3步）
  matchkey <表.列> <参照表.列>         # join 键匹配率 total/miss/%（第4步）
  grain <明细表> <外键> <主表> <主键>  # 粒度：明细/外键/主表/孤儿（第5步）
  fam <前缀> [排除关键词...]           # 家族批量行数，一条命令替代逐表 count（第1步）
```

按顺序做六件事：

### 1. 存在性 + 行数（tables + count）

`tables stock` 一列出来就发现干扰表家族：备份（`_BACK/BAK`）、临时
（`_TMP/TEMP`）、按日分表（8 位后缀）、年表、主表本身。**动态枚举必须用
正则 `^PREFIX_[0-9]{6}$` 收紧**，不能用 LIKE（P0 实测规则）。

### 2. 列结构（cols）

看四类列：

| 类别 | 本项目实例 | 注意点 |
|---|---|---|
| 主键/关联键 | FID / FPID / FAGENIDCODE / FRGNCODE / FBILLID | 决定 join 写法与行级权限 |
| 状态字段 | FSTATE / FCHANGESTATE / FRESULT | **列注释里的取值清单**是免费口径字典 |
| 金额/日期列 | FTOTALAMT / FDATE（VARCHAR2 'YYYY-MM-DD'） | VARCHAR2 日期需 TO_DATE 转换 |
| 敏感字段 | FLINKTEL / FPAYERNAME | mask 或不建维度 |

### 3. 口径分布（sql group by）——先跑分布再写 measures，不猜

```sql
-- P3 实测：FSTATE 1正常=31591 / 2作废=726
-- P4 实测：FCHANGESTATE 61=870/2=104/4=14/1=4（复合码！）
-- P4 实测：FRESULT 0/1/3（列注释只写 0/1/2——实测有 3 无 2）
```

两次实战教训：列注释取值不全（复合码 61/64/31）、甚至与实际不符
（FRESULT 有 3 无 2）。规则：**原样分组 + description 记录实测分布，
不做翻译假设**。

### 4. join 键匹配率（sql not exists）

```sql
select count(*) from FBE_SUSPICIOUS s
where not exists (select 1 from FAB_AGEN a
                  where a.FAGENIDCODE = s.FAGENIDCODE)
-- 0 = 100% 匹配，join 可靠
```

每个 join 键验过才写进 yml。关键发现：

- **FRGNID 是 GUID 不是区划编码**（P4）——直接用没法做行级权限，才定了
  "sql 内 LEFT JOIN 字典翻译 REGION_CODE"方案；
- stock 的 FBILLID 2/488 不匹配（数据毛刺，LEFT JOIN 后 null，写进 description）。

### 5. 粒度核实（count distinct 关联键）

```sql
select count(*), count(distinct FPID) from UBE_STOCK_APPLY_ITEM
-- 237 / 202：明细粒度确认；202 > 主表 201 —— grain 勘误（2026-09-21）：
-- 实测 2 个孤儿 FPID（各 1 行）+ 1 张无明细申领单，两边差值抵消才显得只差 1
-- （最初推断"1 个孤儿 FPID"是错的，202-201 只能得出"差 1"，方向未定）
```

明细行数 ≥ 主表行数，两边 count 不能直接比——这个事实直接决定了
"主子表分两个 cube"的设计。

### 6. 业务实体判定（最容易被跳过、也最值钱的一步）

| 主题 | 疑似 | 核实 | 定案 |
|---|---|---|---|
| P4 stock | UBE_STOCK_RECEIVEAPPLY（30 行）独立表 | FAPPLYID → APPLY.FID 100% 命中 + 票号一致 | **同一单的接收副本**，不建 cube（否则 UNION 重复计数） |
| P4 supervision | fbe_suspicious + rectify 家族三张表 | FBE_SUSPICIOUS 自含完整状态流转（FSTATUS+FRESULT），rectify 1 行/4 行空表 | **只建 suspicious 一个** |
| P2 paybook | 设计写三张表 | 三张 Oracle 全不存在/0 行 | 只建一个 |

**核实结论全部落盘在 yml 头部注释**——每个 cube 文件的 header 就是核实
报告存档（行数、分布、键匹配率、勘误），这是"核实过"的证据链。

---

## 二、构造：cube 的步骤

核实完，一个 cube 的产出顺序固定七步：

| 步骤 | 决策点 | 依据 |
|---|---|---|
| ① 选源 | `sql_table`（单表直连）vs `sql`（UNION/翻译/加工） | 数据在一张物理表 → 直连；多表/需加工 → 子查询。**sql 必须扁平无 GROUP BY**（聚合是 Cube 的事） |
| ② 粒度 + 命名 | 一表一行还是一票多行；业务语言命名 | 粒度决定 cube 拆分（含项目/不含项目两口径 = 两个 cube）；"电脑票"等源系统叫法不进 title |
| ③ measures | count / countDistinct 主键 / sum / 状态拆分（filters 写在度量上） | 主表 count 用主键去重；明细 count 不去重（口径差异靠粒度承担） |
| ④ dimensions | PK `public:false`、时间维度 TO_DATE、技术外键 `public:false`、敏感字段 mask 或不建 | 对外暴露面最小化 |
| ⑤ joins | 有向、many_to_one、**只声明需要的**；主子表加反向 one_to_many | 双向边组成一对（无多路径歧义），供 drill_members |
| ⑥ drill_members | 只加在**业务主度量**上（每 cube 一个） | 下钻口径跟业务指标走，避免每次响应元数据膨胀 |
| ⑦ access_policy + ai_context | 双互补策略（有区划走 row_level、无属性走 allow_all）；mask 必须与 member_level 同一条策略 | 硬语义：策略存在 = 白名单制 |

**编写时的硬约束清单**（都是踩坑换来的，详见 02-p0-p1-记录.md 规则 7-21）：

- 每个 cube 必须有 `sql` 或 `sqlTable` 之一（漏写编译报错）；
- 成员名控制"cube 前缀 + 成员名 ≤ 30 字符"（11g ORA-00972）；
- **有 join 必须有 primary_key**——stock 的源是视图无 FID，用 5 列键拼接
  合成主键（唯一性先 db.js 验证）；
- 多表 UNION 不用 `SELECT t.*`，用列交集（列数不齐 ORA-01789）；
- Jinja 插值拼 SQL 必加 `safe`。

---

## 三、验证闭环（构造后）

```
保存 yml（dev 模式热重载）
  → /v1/meta 确认编译（报错看 docker logs，如 stock 的 primary key）
  → 口径比对：每个 measure 一条 db.js 直查对照（数字必须逐一吻合）
  → 权限：JWT(530100) 收窄值 vs db.js 直查同区划值（逐一吻合）
  → 脱敏：payer_name 显示 **末2字
  → 下钻：单票 join 查询实测出数
  → snap：收尾即落盘 regress/<主题>.baseline.json（P6 全量 diff 用）
```

各阶段验证实测结果：

| 阶段 | 口径对照 | 权限/脱敏 | 基线 |
|---|---|---|---|
| P2 paybook | 状态 3585/979/2691、过期 3217、直缴/汇缴金额 | JWT(530100) 精确收窄 30 行 | 10 查询 |
| P3 cbill/cbill_item | 32317/31591/726/income_amt | JWT 4 场景 + 脱敏 ** 生效 | 12+4 查询 |
| P4 stock 系 | out 992/in 413/apply 201/stock 678/suspicious 19194 | JWT(530100) suspicious 110/stock_out 23/stock 18 + 脱敏 | 12 查询 |

---

## 四、方法论总结

**先核实后建模，结论落注释，口径必对照，收尾即 snap。**

两个要点：

1. **核实的最大价值不在"确认"而在"推翻"**——三次主题（cbill/paybook/stock）
   的表名勘误（设计表名是 ClickHouse/指标 YAML 侧叫法，Oracle 实表必须自己验）、
   RECEIVEAPPLY 副本判定、FRGNID 是 GUID、FRESULT 字典外取值，
   全是"以为是这样、查了才发现不是"；
2. **验证闭环的价值在"可回归"**——每阶段 snap 的基线让 P6 预聚合改造时
   能全量 diff，口径一致性有据可查，而不是"看起来没变"。
