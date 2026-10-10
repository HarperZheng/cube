
## 一、缴款书（收缴起点）

### 1. FNE_PAYBOOK 财政缴款书主表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpaycode | 缴款码 | VARCHAR2 | 60 | Y |
| fdatatype | 数据类型(1.正常;2.未明款冲销确认;7单位暂存款冲销)，其中7是湖北新扩展的类型 | VARCHAR2 | 32 | Y |
| fbustype | 业务类型1直缴，2汇缴 | VARCHAR2 | 32 | Y |
| fchgrgnid | 执收区划ID | VARCHAR2 | 32 | Y |
| fchgrgncode | 执收区划编码 | VARCHAR2 | 32 | Y |
| fchgagenidcode | 执收单位识别码 | VARCHAR2 | 32 | Y |
| fchgagencode | 执收单位编码 | VARCHAR2 | 32 | Y |
| fchgagenname | 执收单位名称 | VARCHAR2 | 200 | Y |
| fauthor | 开票人 | VARCHAR2 | 200 | Y |
| ffilldate | 开票日期 | VARCHAR2 | 10 | Y |
| fpayacctname | 付款账户名称 | VARCHAR2 | 200 | N |
| fpayacct | 付款账户帐号 | VARCHAR2 | 32 | N |
| fpayacctbank | 付款账户开户行 | VARCHAR2 | 200 | N |
| frecacctidcode | 收款账户识别码 | VARCHAR2 | 32 | N |
| frecaccttype | 收款账户类型 | VARCHAR2 | 32 | Y |
| frecacctname | 收款账户名称 | VARCHAR2 | 200 | Y |
| frecacct | 收款账号 | VARCHAR2 | 32 | N |
| frecacctbank | 收款账户开户行名称 | VARCHAR2 | 200 | N |
| ftotalamt | 金额合计 | NUMBER | [18,6] | Y |
| fcheckcode | 校验码 | VARCHAR2 | 20 | N |
| fpaydate | 缴款日期 | VARCHAR2 | 10 | Y |
| fpaytime | 缴款时间 | VARCHAR2 | 19 | N |
| fpaybankcode | 代理银行编码 | VARCHAR2 | 32 | Y |
| fpaymentchannel | 缴款渠道 | VARCHAR2 | 32 | Y |
| fmemo | 备注，20230130深圳扩展到500长度 | VARCHAR2 | 500 | N |
| foperator | 缴款经办人 | VARCHAR2 | 200 | N |
| fbankoutlet | 银行网点编码 | VARCHAR2 | 32 | N |
| ftranobus | 确认交易流水号 | VARCHAR2 | 50 | Y |
| fiscompensation | 是否补偿 | NUMBER | 1 | Y |
| fisreconcile | 是否对账 | NUMBER | 1 | Y |
| feffdate | 缴款书有效期 | VARCHAR2 | 10 | Y |
| faltercode | 变更类型 | VARCHAR2 | 32 | Y |
| fversion | 版本号 | NUMBER | | Y |
| freconciledate | 对账日期 | VARCHAR2 | 10 | N |
| freceiveddate | 资金到账日期 | VARCHAR2 | 10 | N |
| fisreceived | 资金是否到账 | NUMBER | 1 | Y |
| fisfundsrec | 资金是否对账 | NUMBER | 1 | Y |
| ffundsrecdate | 资金对账日期 | VARCHAR2 | 10 | N |
| frecbankcode | 收款银行编码 | VARCHAR2 | 32 | Y |
| fbusinessno | 业务单号 | VARCHAR2 | 50 | N |
| fbusinessorgcode | 业务机构编码 | VARCHAR2 | 32 | N |
| forderno | 20200928扩展，支付订单号,统一支付平台 | VARCHAR2 | 50 | N |
| fappsrc | 数据来源：1:单位端 2:适配器 3缴费平台 9其他，99其他系统历史数据迁移 | VARCHAR2 | 2 | Y |
| fbelongrgncode | 归属区划，缴库级次 | VARCHAR2 | 32 | N |
| fbelongtype | 分成性质 1：常规 2：扩展类型(口岸类) | VARCHAR2 | 2 | N |
| faccagenidcode | 20220407扩展，源于UNE_PAYBOOK的同名字段，即：财政缴款书的执收单位识别码（有可能是代理单位） | VARCHAR2 | 32 | N |
| faccagencode | 20220407扩展，源于UNE_PAYBOOK的同名字段，即：财政缴款书的执收单位编码（有可能是代理单位） | VARCHAR2 | 32 | N |
| faccagenname | 20220407扩展，源于UNE_PAYBOOK的同名字段，即：财政缴款书的执收单位名称（有可能是代理单位） | VARCHAR2 | 200 | N |
| ffundserialno | 20220526扩展用于给银行提供清分缴款对账数据；缴款码到账资金流水号 | VARCHAR2 | 60 | N |
| fcustom1 | | VARCHAR2 | 200 | N |
| fcustom2 | | VARCHAR2 | 200 | N |
| pfdate | 三代建表时被添加，对标缴款日期 | DATE | | |

---

### 2. FNE_PAYBOOK_ITEM 财政缴款书明细表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpid | 所属缴款书ID | VARCHAR2 | 32 | Y |
| fsortno | 序号 | NUMBER | | Y |
| fitemidcode | 项目识别码 | VARCHAR2 | 32 | Y |
| fitemcode | 项目编码 | VARCHAR2 | 32 | Y |
| fitemname | 项目名称 | VARCHAR2 | 200 | Y |
| fitemstdidcode | 项目标准识别码 | VARCHAR2 | 32 | N |
| fitemstdcode | 项目标准编码 | VARCHAR2 | 32 | N |
| fitemstdname | 项目标准名称 | VARCHAR2 | 200 | N |
| fnumber | 执收数量 | NUMBER | [18,6] | Y |
| fstd | 执收标准 | NUMBER | [18,6] | N |
| famt | 执收金额 | NUMBER | [18,6] | Y |
| ffundsnaturecode | 资金性质代码 | VARCHAR2 | 32 | Y |
| ffundsnaturename | 资金性质名称 | VARCHAR2 | 200 | Y |
| fsubid | 收入科目Id | VARCHAR2 | 32 | N |
| fsubcode | 收入科目编码 | VARCHAR2 | 32 | N |
| fsubname | 收入科目名称 | VARCHAR2 | 200 | N |
| fversion | 版本号 | NUMBER | | Y |
| faltercode | 变更类型 | VARCHAR2 | 32 | Y |
| fcenitemidcode | 全国项目识别码 | VARCHAR2 | 32 | N |
| fisclear | 是否清分 | NUMBER | 1 | Y |
| fcleardate | 清分日期 | VARCHAR2 | 10 | N |
| fcleartime | 清分时间 | VARCHAR2 | 22 | N |
| fdate | 缴款日期 | VARCHAR2 | 10 | Y |
| fchgrgncode | 执收区划编码 | VARCHAR2 | 32 | Y |
| fretireamt | 可退金额 | NUMBER | [18,6] | N |
| funits | 计量单位 | VARCHAR2 | 200 | N |

## 二、清分划拨（资金流转）

### 1. FNE_FundDivide 资金分解明细表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 50 | Y |
| fcleardate | 清算日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | Y |
| fcleartime | 清算时间，格式：yyyy-MM-dd HH24:mi:ssff3 | VARCHAR2 | 22 | Y |
| fcleartaskno | 清算任务流水号 | VARCHAR2 | 32 | Y |
| fdate | 缴款日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | Y |
| fyear | 缴款年度 | VARCHAR2 | 4 | N |
| fpaycode | 缴款码 | VARCHAR2 | 30 | Y |
| fpaybooksubid | 缴款书明细ID | VARCHAR2 | 32 | Y |
| fbankcode | 付款银行编码，即缴款书里的收款银行编码 | VARCHAR2 | 50 | Y |
| fbelongrgncode | 20180523扩展，归属区划编码，表明缴款的业务数据是哪个归属哪个区划的 | VARCHAR2 | 32 | N |
| fchgrgncode | 执收区划编码 | VARCHAR2 | 50 | N |
| fpayaccttype | 执收账户类型 | VARCHAR2 | 32 | Y |
| fpayacctidcode | 20160718增加，执收账户识别码，缴款书表中的收款账户识别码 | VARCHAR2 | 32 | N |
| fpaychannel | 执收缴款渠道 | VARCHAR2 | 32 | Y |
| fchgagenidcode | 执收单位识别码 | VARCHAR2 | 64 | Y |
| fchgagencode | 执收单位编码 | VARCHAR2 | 64 | Y |
| fchgagenname | 执收单位名称 | VARCHAR2 | 200 | Y |
| frecrgncode | 收入区划编码 | VARCHAR2 | 64 | Y |
| frecagenidcode | 收入单位识别码，特定分成中有具体指定则清分时要记录，否则清分时不计 | VARCHAR2 | 32 | N |
| frecaccttype | 收入账户类型，特定分成设置时才有值，最终资金需归入的账户类型，与账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；6、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| frecacctidcode | 收入账户识别码，特定分成中有具体指定则清分时要记录，否则清分时不计 | VARCHAR2 | 32 | N |
| fsubcode | 预算科目编码 | VARCHAR2 | 50 | Y |
| fitemidcode | 项目识别码 | VARCHAR2 | 64 | Y |
| fitemcode | 项目编码 | VARCHAR2 | 64 | Y |
| fitemname | 项目名称 | VARCHAR2 | 200 | Y |
| fbgtstyle | 资金管理方式，1国库,2专户,3代收,4其他，取缴款书的FundSort字段值中的首字母值 | VARCHAR2 | 32 | Y |
| ffundsort | 20160803扩展，资金性质，取缴款书的FundSort字段值中的值 | VARCHAR2 | 32 | N |
| fcalcsource | 分解来源：1不分成 2分成 3提留 4余额，如果值为3，则BgStyle字段值同步要取3（代收） | VARCHAR2 | 1 | Y |
| fimamt | 分入金额 | NUMBER | [18,6] | N |
| fretireamt | 20200117扩展，可退余额 | NUMBER | [18,6] | N |
| fclearorder | 20200311扩展，清分序号，从1开始，在每笔缴款明细记录中唯一 | INT | | Y |
| fcollectid | 清算汇总ID，开始取数汇总时，可以更新为中间值0，汇总成功后更新成真正值，失败重置空 | VARCHAR2 | 32 | N |
| fispayenter | 20211124扩展，是否缴款到账，0否 1是 | VARCHAR2 | 1 | Y |
| fpayenterdate | 20211124扩展，缴款到账日期 | VARCHAR2 | 10 | N |
| foperatetime | 20180914扩展到33位长度，取数时间，格式：yyyy-MM-dd HH24:mi:ssff3 | VARCHAR2 | 33 | N |
| fversion | 20190425扩展，版本号，数据新增和更新时，需要更新此值 | NUMBER | | Y |
| fcreatetime | 20191212扩展，创建时间，格式：yyyy-MM-dd HH24:mm:ssff3 | VARCHAR2 | 22 | Y |
| fcenitemidcode | 20220121扩展，便于写收入；全国项目识别码 | VARCHAR2 | 32 | N |
| fmemo | 20220706扩展，用于记录备注信息 | NVARCHAR2 | 200 | N |
| fitemamt | 20220526扩展，便于写收入，项目执收金额 | NUMBER | [18,6] | N |
| fpayacctname | 20240321扩展，执收账户名称，便于写收入 | VARCHAR2 | 200 | N |
| fpayacctbankname | 20240321扩展，执收账户开户行名称，便于写收入 | VARCHAR2 | 200 | N |
| fsubid | 20240321扩展，预算科目ID，便于写收入 | VARCHAR2 | 32 | N |
| fsubname | 20240321扩展，预算科目名称，便于写收入 | VARCHAR2 | 200 | N |
| fbustype | 20240321扩展，便于写收入，业务类型1直缴，2汇缴 | VARCHAR2 | 2 | N |
| fchgrgnid | 20240321扩展，便于写收入，执收区划ID | VARCHAR2 | 32 | N |

### 2. FNE_Collect_To_Transfer 汇总划拨流水表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 50 | Y |
| fdate | 缴款日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | Y |
| fpaymonth | 20240129扩展，缴款月份，格式：yyyyMM，用于分表分库逆向查询时，知道是哪个分表 | VARCHAR2 | 6 | Y |
| ftranscollectid | 划拨汇总记录的主键ID | VARCHAR2 | 32 | Y |
| ftransferno | 划拨凭证号 | VARCHAR2 | 32 | Y |
| ftransferid | 划拨单记录ID | VARCHAR2 | 32 | Y |
| ftransferitemid | 划拨明细单记录ID | VARCHAR2 | 32 | N |
| famt | 划拨金额 | NUMBER | [18,6] | N |
| fbgtstyle | 20220308扩展，资金管理方式，1国库,2专户,3代收,4其他 | VARCHAR2 | 2 | N |
| fcollectid | 20220410扩展，汇总记录ID，与分解表中的汇总记录ID值一致，配套节点顺序可唯一验证 | VARCHAR2 | 50 | N |

### 3. FNE_Transfer_Collect 划拨汇总表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键，如果本次划入账户类型和分入账户类型是一致的，则要把此值写入到对应的清分汇总表中 | VARCHAR2 | 50 | Y |
| fcollectid | 20220307扩展，汇总记录ID，与分解表中的汇总记录ID值一致，配套节点顺序可唯一验证 | VARCHAR2 | 50 | Y |
| fdate | 缴款日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fyear | 缴款年度 | VARCHAR2 | 4 | N |
| fpayenterdate | 20191030扩展，缴款到账日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fbelongrgncode | 20180523扩展，归属区划编码，表明缴款的业务数据是哪个归属哪个区划的 | VARCHAR2 | 32 | N |
| fchgrgncode | 执收区划编码 | VARCHAR2 | 32 | Y |
| fpayrgncode | 20220401扩展，付款区划编码，默认与执收区划编码值相同，当划拨路径设置的划入节点跨区划，则取划拨路径设置的值 | VARCHAR2 | 32 | Y |
| fchgagenidcode | 20160919扩展，执收单位识别码 | VARCHAR2 | 32 | N |
| fpaychannel | 执收缴款渠道 | VARCHAR2 | 32 | N |
| fbankcode | 付款银行编码，因202207湖南非税只要单位项目汇总，改为非必填 | VARCHAR2 | 32 | N |
| fpayaccttype | 付款账户类型，与账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；7、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| fpayacctidcode | 付款账户识别码 | VARCHAR2 | 32 | N |
| frecrgncode | 收入区划编码 | VARCHAR2 | 32 | N |
| frecagenidcode | 收入单位识别码，如果值为空，根据清分汇总表中的执收单位和项目来确定分入单位 | VARCHAR2 | 32 | N |
| fsubcode | 预算科目编码 | VARCHAR2 | 32 | Y |
| fbgtstyle | 资金管理方式，1国库,2专户,3代收,4其他，取缴款书的FundSort字段值中的首字母值 | VARCHAR2 | 20 | Y |
| ffundsort | 20160803扩展，资金性质，取缴款书的FundSort字段值中的值 | VARCHAR2 | 32 | N |
| frecbankcode | 收款银行编码 | VARCHAR2 | 32 | N |
| frecaccttype | 收入账户类型，最终资金需归入的账户类型，与账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；7、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| frecacctidcode | 收入账户识别码 | VARCHAR2 | 32 | N |
| fimamt | 分入金额 | NUMBER | [18,6] | N |
| funtranamt | 未划拨金额 | NUMBER | [18,6] | N |
| foriginalamt | 20200115扩展，原始分入金额，如果没有抵扣掉，则此值与分入金额值一致，否则比分入金额值大 | NUMBER | [18,6] | N |
| ftorgncode | 本次划入区划编码 | VARCHAR2 | 32 | N |
| ftobankcode | 本次划入银行编码 | VARCHAR2 | 32 | Y |
| ftoaccttype | 记录本次划拨划入的账户类型，与账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、科目；4、单位代收账户；5、国库账户；7、单位清分账户 | VARCHAR2 | 32 | N |
| ftoacctidcode | 本次收入账户识别码 | VARCHAR2 | 32 | N |
| fitemidcode | 20210127扩展，项目识别码，如果不是共享级预算科目分项目设置，则此字段为空 | VARCHAR2 | 32 | N |
| fparentid | 前划拨汇总ID，由上一批划拨汇总后再继续划拨，记录上批的划拨汇总ID | VARCHAR2 | 32 | N |
| fparententerdate | 20220308扩展，前划拨记录到账日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| foperatestatus | 操作状态：0未取数，1正在取数，2 已经被汇总生成划拨单，3退付冻结锁定， 4数据校验错误 | VARCHAR2 | 1 | Y |
| foperatetime | 20180914扩展到33位长度，取数时间，格式：yyyy-MM-dd HH24:mi:ssff3 | VARCHAR2 | 33 | N |
| fcreatetime | 20191212扩展，创建时间，格式：yyyy-MM-dd HH24:mm:ssff3 | VARCHAR2 | 22 | Y |

### 4. FNE_Capital_Transfer 资金划转主表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 50 | Y |
| ftransno | 划拨凭证号，全表唯一 | VARCHAR2 | 32 | Y |
| fpayyear | 缴款年度 | VARCHAR2 | 4 | N |
| fpaydate | 缴款日期，格式：yyyy-MM-dd，汇总项有缴款日期，此值就是缴款日期，如果没有则是生成单子日期 | VARCHAR2 | 10 | Y |
| fpaymonth | 20220610扩展，缴款月份，格式：yyyyMM，用于分表分库逆向查询时，知道是哪个分表 | VARCHAR2 | 6 | Y |
| fbelongrgncode | 20180523扩展，归属区划编码，表明缴款的业务数据是哪个归属哪个区划的 | VARCHAR2 | 32 | N |
| fchgrgncode | 执收区划编码 | VARCHAR2 | 32 | N |
| fchgagenidcode | 20160919扩展，执收单位识别码 | VARCHAR2 | 32 | N |
| fpaychannel | 执收缴款渠道 | VARCHAR2 | 32 | N |
| fbankcode | 付款银行编码 | VARCHAR2 | 32 | Y |
| fpayaccttype | 付款账户类型，与账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；7、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| fpayacctidcode | 付款账户识别码 | VARCHAR2 | 32 | N |
| fpayacct | 付款账号 | VARCHAR2 | 50 | N |
| fpayacctname | 付款账户名称 | VARCHAR2 | 200 | N |
| fpaybankorgcode | 付款行组织机构代码 | VARCHAR2 | 20 | N |
| fpaybankname | 付款开户行名称 | VARCHAR2 | 200 | N |
| fpaybankno | 付款行行号，无论商业银行划转，还是金库划转，都要有 | VARCHAR2 | 20 | N |
| fmsgpayaccttype | 在前置中付款账户类型，发报文给前置时，取这个值，取值范围与前置中一致：1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；9、其他 | VARCHAR2 | 32 | N |
| frecrgncode | 分入区划编码 | VARCHAR2 | 32 | N |
| frecagenidcode | 分入单位识别码 | VARCHAR2 | 32 | N |
| frecbankcode | 收款银行编码 | VARCHAR2 | 32 | Y |
| frecacctidcode | 收款账户识别码 | VARCHAR2 | 32 | Y |
| frecacct | 收款账号 | VARCHAR2 | 50 | Y |
| frecacctname | 收款账户名称 | VARCHAR2 | 200 | N |
| frecbankorgcode | 收款行组织机构代码 | VARCHAR2 | 20 | N |
| frecbankname | 收款开户行名称 | VARCHAR2 | 200 | N |
| frecbankno | 收款行行号，无论商业银行划转，还是金库划转，都要有 | VARCHAR2 | 20 | N |
| frecorgcode | Tips扣款使用 | VARCHAR2 | 20 | N |
| frecaccttype | 收款账户类型，同付款账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；7、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| fmsgrecaccttype | 在前置中收款账户类型，发报文给前置时，取这个值，取值范围与前置中一致：1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；9、其他 | VARCHAR2 | 32 | N |
| famt | 划拨总金额 | NUMBER | [18,6] | N |
| ftransferdate | 20160718扩展，划转日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fenterdate | 到账日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fishandtrans | 划转模式，0、自动报文划拨；1、手动划拨；2、Tips划拨 | VARCHAR2 | 1 | Y |
| fprintnum | 20200907扩展，划拨单打印次数，每打印一次，此数要加1 | NUMBER | | Y |
| fpaycode | 20170918扩展缴款码 | VARCHAR2 | 32 | N |
| foperatestatus | 20180703扩展，被取数状态，0 未取数；1：已取数 | VARCHAR2 | 1 | Y |
| ftaskno | 20180914扩展，划转任务批次号 | VARCHAR2 | 33 | Y |
| fbuildmode | 20190118扩展，单据生成模式，0自动生成，1手动生成 | VARCHAR2 | 1 | Y |

### 5. FNE_Transfer_Bank_Msg 商业银行资金划转表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpaymonth | 20240129扩展，缴款月份，格式：yyyyMM，用于分表分库逆向查询时，知道是哪个分表 | VARCHAR2 | 6 | Y |
| fbankcode | 银行编码 | VARCHAR2 | 32 | Y |
| ftransno | 划拨凭证号 | VARCHAR2 | 30 | Y |
| fdate | 委托发送日期，也就是报文发送日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fstats | 0、划转未发；1、划转已发；7、划转失败；9、划转成功；14、划转记录内部校验不通过 | VARCHAR2 | 2 | N |
| fstatsmemo | 报文状态备注 | VARCHAR2 | 250 | N |
| fconfirmtype | 划转确认类型：1、自动、2、人工手动 | INTEGER | | N |
| fistransfer | 是否划转：0否 1是 | VARCHAR2 | 1 | Y |
| ftransdate | 划转日期，格式：yyyy-MM-dd，在2614回执时更新 | VARCHAR2 | 10 | N |
| ftranstime | 划转时间，格式：yyyy-MM-dd HH24:mm:sssss | VARCHAR2 | 22 | N |
| fisenter | 是否到账：0否 1是，在2615回执时更新 | VARCHAR2 | 1 | Y |
| fenterdate | 到账日期，格式：yyyy-MM-dd，在2615回执时更新 | VARCHAR2 | 10 | N |
| fentertype | 到账确认类型：1、自动、2、手工 | INTEGER | | N |
| fisexp | 报文记录是否已生成到划转文件，0：否 1：是 | VARCHAR2 | 1 | Y |
| fisautotran | 是否自动划拨 0否 1是 | VARCHAR2 | 1 | N |
| foperatestatus | 20160803扩展，被取数状态，0 未取数；1：正在取数；2：已取数 | VARCHAR2 | 1 | Y |
| foperatetime | 20160803扩展，取数时间，格式：yyyy-MM-dd HH24:mi:ssff3 | VARCHAR2 | 24 | N |
| freconcilestatus | 到账对账状态，0:未对账;1:对账成功;2对账失败，在2557回执时更新 | VARCHAR2 | 1 | Y |
| freconciledate | 到账对账日期，格式：yyyy-MM-dd，在2557回执时更新 | VARCHAR2 | 10 | N |
| fischeck | 20191230扩展，划拨单发送前是否需要校验，0 不需要；1需要 | VARCHAR2 | 1 | Y |
| fpayaccttype | 20240408微服务扩展(便于写收入，付款账户类型 | VARCHAR2 | 2 | N |

## 三、资金缴库（入库）

### 1. FNE_Treasury_Transfer 资金缴库单（资金缴库主表）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 50 | Y |
| ftransno | 缴库凭证号，全表唯一，缴库单号02开头 | VARCHAR2 | 32 | Y |
| fprinttransno | 20190322新增，外部套打打印缴库单号，业务上唯一，默认值与缴库凭证号一样 | VARCHAR2 | 20 | Y |
| fpayyear | 缴款年度 | VARCHAR2 | 4 | N |
| fpaymonth | 20220610扩展，缴款月份，格式：yyyyMM，用于分表分库逆向查询时，知道是哪个分表 | VARCHAR2 | 6 | Y |
| fpaydate | 缴款日期，格式：yyyy-MM-dd，汇总项有缴款日期，此值就是缴款日期，如果没有则是生成单子日期 | VARCHAR2 | 10 | N |
| fbuilddate | 生成日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | Y |
| fbelongrgncode | 20180523扩展，归属区划编码，表明缴款的业务数据是哪个归属哪个区划的 | VARCHAR2 | 32 | N |
| fchgrgncode | 执收区划编码 | VARCHAR2 | 32 | N |
| fchgagenidcode | 执收单位识别码 | VARCHAR2 | 32 | N |
| fchgagencode | 执收单位编码 | VARCHAR2 | 32 | N |
| fchgagenname | 执收单位名称 | VARCHAR2 | 200 | N |
| fpaychannel | 执收缴款渠道 | VARCHAR2 | 32 | N |
| fbankcode | 付款银行编码 | VARCHAR2 | 32 | Y |
| fbankname | 付款银行名称 | VARCHAR2 | 100 | N |
| fpayaccttype | 付款账户类型，与账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；7、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| fpayacctidcode | 付款账户识别码 | VARCHAR2 | 32 | N |
| fpayacct | 付款账号 | VARCHAR2 | 50 | N |
| fpayacctname | 付款账户名称 | VARCHAR2 | 200 | N |
| fpaybankorgcode | 付款行组织机构代码 | VARCHAR2 | 20 | N |
| fpaybankopenname | 付款开户行名称 | VARCHAR2 | 200 | N |
| fpaybankno | 付款行行号 | VARCHAR2 | 20 | N |
| fpaybankopenno | 付款行开户行行号(从三方协议取) | VARCHAR2 | 20 | N |
| fmsgpayaccttype | 在前置中付款账户类型，发报文给前置时，取这个值，取值范围与前置中一致：1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；9、其他 | VARCHAR2 | 32 | N |
| frecrgncode | 分入区划编码 | VARCHAR2 | 32 | N |
| frecagenidcode | 分入单位识别码 | VARCHAR2 | 32 | N |
| frecagencode | 分入单位编码 | VARCHAR2 | 32 | N |
| frecagenname | 分入单位名称 | VARCHAR2 | 200 | N |
| frecbankcode | 收款银行编码 | VARCHAR2 | 32 | Y |
| frecbankname | 收款银行名称 | VARCHAR2 | 100 | N |
| frecacctidcode | 收款账户识别码 | VARCHAR2 | 32 | Y |
| frecacct | 收款账号 | VARCHAR2 | 50 | Y |
| frecacctname | 收款账户名称 | VARCHAR2 | 200 | N |
| frecbankorgcode | 收款行组织机构代码 | VARCHAR2 | 20 | N |
| frecbankopenname | 收款开户行名称 | VARCHAR2 | 200 | N |
| frecbankno | 收款行行号 | VARCHAR2 | 20 | N |
| frecorgcode | 收款国库代码 | VARCHAR2 | 20 | N |
| frecorgname | 收款国库名称 | VARCHAR2 | 200 | N |
| frecaccttype | 收款账户类型，同付款账户类型取值范围一致：0、虚拟账户；1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；6、单位清分账户；9、其他 | VARCHAR2 | 32 | N |
| fmsgrecaccttype | 在前置中收款账户类型，发报文给前置时，取这个值，取值范围与前置中一致：1、财政专户；2、汇缴专户；3、待解缴科目；4、单位监管账户；5、国库账户；9、其他 | VARCHAR2 | 32 | N |
| ffundsort | 资金性质，取缴款书的FundSort字段值中的值 | VARCHAR2 | 32 | N |
| famt | 缴库总金额 | NUMBER | [18,6] | N |
| fishandtrans | 缴金库模式，0、自动报文缴库；1、人工缴库（线下缴库）；2、Tips缴库；3、凭证缴库；4、代理银行缴库 | VARCHAR2 | 1 | Y |
| fpaycode | 20170918扩展缴款码 | VARCHAR2 | 32 | N |
| ftaxorgcode | 征收机关代码 | VARCHAR2 | 20 | N |
| ftaxpayercode | 纳税人编码(从三方协议取) | VARCHAR2 | 32 | N |
| ftaxpayername | 纳税人名称(从三方协议取) | VARCHAR2 | 200 | N |
| fprintnum | 20200907扩展，缴库单打印次数，每打印一次，此数要加1 | NUMBER | | Y |
| fsublevel | 20180105扩展，预算级次代码 | VARCHAR2 | 20 | N |
| fsublevelname | 20180105扩展，预算级次名称 | VARCHAR2 | 100 | N |
| ftaskno | 20180914扩展，任务批次号，取数时锁定数据用 | VARCHAR2 | 33 | Y |
| fmsgbatchno | 20180110扩展，缴库批次号 用于凭证缴库 | VARCHAR2 | 50 | N |
| fbuildmode | 20190118扩展，单据生成模式，0自动生成，1手动生成 | VARCHAR2 | 1 | Y |
| fisfinish | 20190121扩展，工作流是否完成，0未完成，1已完成 | VARCHAR2 | 1 | Y |
| fchangestate | 20190121扩展，当前工作流程状态 | VARCHAR2 | 150 | N |
| fchangestatename | 20190121扩展，当前工作流程状态名称 | VARCHAR2 | 150 | N |
| fauthorcode | 20190121扩展，工作流程发起者编码 | VARCHAR2 | 50 | N |
| fauditmsg | 20190121扩展，流程意见 | VARCHAR2 | 200 | N |
| frealrecrgncode | 20190412扩展，实际分入区划编码，默认值跟分入区划值相同，凭证缴库时存在与分入区划值有差异 | VARCHAR2 | 32 | N |
| frealsublevel | 20190412扩展，实际预算级次代码，默认值跟预算级次值相同，凭证缴库时存在与预算级次代码值有差异 | VARCHAR2 | 20 | N |
| fversion | 20190425扩展，版本号，数据新增和更新时，需要更新此值 | NUMBER | | Y |
| fcreatetime | 20191212扩展，创建时间，格式：yyyy-MM-dd HH24:mm:ssff3 | VARCHAR2 | 22 | Y |

### 2. FNE_Treasury_Trans_Item 资金缴库明细表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpaymonth | 20240129扩展，缴款月份，格式：yyyyMM，用于分表分库逆向查询时，知道是哪个分表 | VARCHAR2 | 6 | Y |
| fparentid | 主表记录ID | VARCHAR2 | 32 | Y |
| ftransno | 缴库凭证号，值与主表一致，走TIPS系统，只能是20位长度 | VARCHAR2 | 32 | Y |
| forder | 顺序号 | INTEGER | | N |
| fpayyear | 缴款年度 | VARCHAR2 | 4 | N |
| fsubcode | 预算科目编码 | VARCHAR2 | 32 | Y |
| fsubname | 预算科目名称 | VARCHAR2 | 200 | N |
| fsublevel | 预算级次代码 | VARCHAR2 | 20 | Y |
| fsublevelname | 预算级次名称 | VARCHAR2 | 100 | N |
| famt | 金额 | NUMBER | [18,6] | N |
| fsharerate | 分成比例串，通过Tips缴金库的时候，需要提供分成比例的串 | VARCHAR2 | 35 | N |
| fpaycode | 20180105扩展，缴款码，目前吉林在用 | VARCHAR2 | 32 | N |

### 3. FNE_Treasury_Transfer_Msg 缴库资金划转信息表

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpaymonth | 20240129扩展，缴款月份，格式：yyyyMM，用于分表分库逆向查询时，知道是哪个分表 | VARCHAR2 | 6 | Y |
| fbuilddate | 生成日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fsenddate | 缴库发送日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| ftransdate | 扣款日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| ftranstime | 扣款时间，格式：yyyy-MM-dd HH24:mi:ssff3 | VARCHAR2 | 22 | N |
| ftransno | 缴库单号 | VARCHAR2 | 30 | Y |
| fvouchercode | 20180118扩展，凭证编号，用来缴库的时候，人行返回的编号(缴库回执时填写) | VARCHAR2 | 36 | N |
| fmsgbatchno | 20180531扩展，商业银行缴库单号，如果不是凭证缴库，则跟缴库单号值相同 | VARCHAR2 | 32 | Y |
| fstatus | tips缴库状态：0未缴库，1:缴库在途，2:扣款成功，3:缴库失败，4:超时，5:缓缴，9:缴库成功，14：划转记录内部校验不通过；电子凭证缴库/代理行缴库：30报文未发，31报文已发，32报文回执失败，33报文回执成功，35:缴库在途，37:缴库失败，39:缴库成功 | VARCHAR2 | 2 | N |
| fstatusmemo | 缴库状态备注 | VARCHAR2 | 250 | N |
| fbillstatus | 单据状态 | VARCHAR2 | 32 | N |
| freceiptdays | 回执期限(天) | VARCHAR2 | 10 | N |
| faddword | 附言 | VARCHAR2 | 200 | N |
| fenterstatus | 入库状态:0:未入库;1:已入库; | VARCHAR2 | 1 | Y |
| fenterdate | 入库日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| freconcilestatus | 对账状态0:未对账;1:对账成功;2对账失败; | VARCHAR2 | 1 | Y |
| freconciledate | 对账日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fishandtrans | 缴金库模式: 1、人工缴库；2、Tips缴库；3、电子凭证缴库；4、代理银行缴库 | VARCHAR2 | 1 | N |
| ftreatype | 缴库类型0:实时缴库1:批量缴库;2:人工缴库; | VARCHAR2 | 1 | N |
| fisexp | 报文记录是否已生成到缴库文件，0：否 1：是 | VARCHAR2 | 1 | Y |
| foperatestatus | 取数状态，0 未取数；1：正在取数；2：已取数 | VARCHAR2 | 1 | Y |
| foperatetime | 取数时间，格式：yyyy-MM-dd HH24:mi:ssff3 | VARCHAR2 | 24 | N |
| ftaxvouno | 税票号码 | VARCHAR2 | 32 | N |
| fbusinessno | 交易流水 | VARCHAR2 | 32 | N |
| fpaydictateno | 20180108扩展，支付交易序号，商业银行通过现代化支付系统汇划资金时产生，二代支付系统填写后8位 | VARCHAR2 | 10 | N |
| fpaymsgno | 20180108扩展，支付报文编号：大额支付系统为100，103；小额支付系统为001；二代大额支付系统为111，112；二代小额支付系统为121，122 | VARCHAR2 | 10 | N |
| fpayentrustdate | 20180108扩展，支付委托日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fentrustdate | 20180108扩展，缴库申请日期，格式：yyyy-MM-dd | VARCHAR2 | 10 | N |
| fpayincomestatus | 20180124扩展，0未写缴库支出收入，1已写缴库支出收入 | VARCHAR2 | 2 | Y |
| fincomestatus | 20180124扩展，0未写国库收入，1已写国库收入 | VARCHAR2 | 2 | Y |
| funifystatus | 20220317扩展，对应缴库单是否已抽成中间表数据 0未抽取，1已抽取 | VARCHAR2 | 2 | Y |
| fversion | 20230328厦门扩展，版本号，数据新增和更新时，需要更新此值 | NUMBER | | Y |
| fchgrgncode | 20240304微服务扩展(便于写收入)，执收区划编码，可为空 | VARCHAR2 | 20 | N |
| fpayaccttype | 20240408微服务扩展(便于写收入)，付款账户类型 | VARCHAR2 | 2 | N |
| fbankcode | 20240408微服务扩展(便于写收入)，银行编码 | VARCHAR2 | 32 | N |

> **票据侧说明**（四~六节）：以下 10 张票据侧表 ，结构取自**生产库实测**（yn0411）：
>
> - **主键全部为 fid**（单列，非空强制）。
> - **生产库仅 fid 非空**，上文设计稿中的"强制"约束在库层未实施；且 10 张表**均无外键约束**，主子表关联为逻辑外键（fpid → 主表 fid）。
> - 列中文名称：库里有注释的照录；无注释的按同构表同名字段（FNE_PAYBOOK_ITEM 设计稿等）补注；无法确定的留空。
> - 实测行数：UNE_CBILL 6772 / UNE_CBILL_ITEM 8284 / UNE_PAYBOOK 7316 / UNE_PAYBOOK_ITEM 8068 / UNE_PAYBOOK_CONFIRM 3080 / UNE_WRITEOFF 2881 / UNE_HBILL 0 / UNE_HBILL_ITEM 0 / UBE_STOCK_INVALID 100 / UBE_STOCK_INVALID_ITEM 230（UNE_HBILL 本库无数据，与 23-数据源说明一致）。

## 四、开具票据（票据流，生产库实测）

### 1. UNE_CBILL 电子票据主表（官方表注释：电脑票，实测 105 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 50 | N |
| fagencode | 执收单位编码 | VARCHAR2 | 60 | N |
| fagenname | 执收单位名称 | VARCHAR2 | 200 | N |
| faccagenidcode | 缴款书执收单位识别码（有可能是代理单位） | VARCHAR2 | 50 | N |
| faccagencode | 缴款书执收单位编码（有可能是代理单位） | VARCHAR2 | 60 | N |
| faccagenname | 缴款书执收单位名称（有可能是代理单位） | VARCHAR2 | 200 | N |
| fplaceid | | VARCHAR2 | 32 | N |
| fplacecode | | VARCHAR2 | 60 | N |
| fplacename | | VARCHAR2 | 200 | N |
| fpayername | 缴款人名称 | NVARCHAR2 | 120（字符） | N |
| fpayertel | 缴款人电话 | VARCHAR2 | 74 | N |
| fdate | 开票日期 | VARCHAR2 | 10 | N |
| fauthor | 开票人 | VARCHAR2 | 200 | N |
| fbillid | 票据ID | VARCHAR2 | 32 | N |
| fbillbatchcode | 等同于票据批次号 | VARCHAR2 | 60 | N |
| fbillno | 票据号码 | VARCHAR2 | 20 | N |
| fmemo | 备注 | VARCHAR2 | 500 | N |
| fsecuritycode | 防篡改校验码（用于验证本笔记录是否被篡改） | VARCHAR2 | 60 | N |
| fcheckcode | 验证码（用于网上查询时，输入票号＋验证码） | VARCHAR2 | 20 | N |
| ftotalamt | 金额合计 | NUMBER | [18,6] | N |
| fbillsource | 票据数据来源：1手工输入 2接口转入 | VARCHAR2 | 32 | N |
| frecmode | 收款方式：1现金 2转账 3其它 | VARCHAR2 | 32 | N |
| fexternalid | 非手工录入的记录，通过服务或接口方式转入的 | VARCHAR2 | 50 | N |
| fbustype | 票据业务类型：1常规开票 2电子转纸质 3冲销开票 4直缴转开票 5作废 6取消作废 | VARCHAR2 | 32 | N |
| fisinvoice | 是否开票业务（1是 0否；业务类型1,2,3,4为开票业务） | NUMBER | 1 | N |
| fisincome | 是否收入业务（1是 0否；业务类型1,2,3,5,6为收入业务） | NUMBER | 1 | N |
| fstate | 票据状态：1正常 2作废 | VARCHAR2 | 32 | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 32 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 32 | N |
| fcustom1~fcustom2 | 扩展字段 | VARCHAR2 | 120 | N |
| fcustom3 | 扩展字段 | VARCHAR2 | 500 | N |
| fcustom4 | 扩展字段 | VARCHAR2 | 300 | N |
| fcustom5~fcustom37 | 扩展字段 | VARCHAR2 | 200 | N |
| fbatchno | 汇缴批次号 | VARCHAR2 | 50 | N |
| fsignature | 电子签名 | BLOB | | N |
| fsoftwareversion | 软件版本：Treasury财政部版 / General通用版 / Fujian福建 | VARCHAR2 | 20 | N |
| fpbcbillid | 电子票转纸质票后对应那张纸质票id（注释：此字段可以不要了） | VARCHAR2 | 32 | N |
| fpayerno | 付款人账号 | VARCHAR2 | 50 | N |
| fpayerbank | 付款人开户银行 | VARCHAR2 | 200 | N |
| fpayeraccname | 付款人户名 | VARCHAR2 | 100 | N |
| frecname | 收款人全称 | VARCHAR2 | 200 | N |
| frecno | 收款人账号 | VARCHAR2 | 50 | N |
| frecbank | 收款人开户银行 | VARCHAR2 | 200 | N |
| frecaccname | 收款人户名 | VARCHAR2 | 100 | N |
| fpaycode | 缴款书缴款码 | VARCHAR2 | 60 | N |
| fsignaturealgorithm | 签名算法 | VARCHAR2 | 200 | N |
| fsignaturetime | 签名时间 | VARCHAR2 | 200 | N |
| fserialnumber | 证书编号 | VARCHAR2 | 200 | N |
| ffinsignature | 财政签名 | VARCHAR2 | 200 | N |
| fpayertype | 缴款人类型 | VARCHAR2 | 2 | N |
| fcreditcode | 组织机构代码/统一社会信用代码 | VARCHAR2 | 200 | N |
| frelatedbillid | 关联的票据id | VARCHAR2 | 32 | N |
| frelatedbillbatchcode | 关联的票据代码 | VARCHAR2 | 60 | N |
| frelatedbillno | 关联的票号 | VARCHAR2 | 20 | N |
| fbatchimportno | 批导批次号 | VARCHAR2 | 64 | N |
| fpayeremail | 缴款人邮箱 | VARCHAR2 | 50 | N |
| frelatedcheckcode | 关联的票据验证码 | VARCHAR2 | 20 | N |
| handwrittensign | 签名图片（提供给APP使用） | BLOB | | N |
| freviewer | 复核人 | VARCHAR2 | 200 | N |
| finterfaceflag | 接口来源标识：0非接口开票，1源于非税接口开票 | NUMBER | 1 | N |
| fsernumber | 接口业务流水号，唯一码 | VARCHAR2 | 50 | N |
| fisverificate | 是否已审验 | VARCHAR2 | 1 | N |
| fisarriveaccount | 是否已到账 | VARCHAR2 | 1 | N |
| finvalidtype | 作废类型：1遗失 2其他 | VARCHAR2 | 1 | N |
| febillprintnumber | 电子票打印次数 | NUMBER | | N |
| fisvoucher | 是否已记账 | VARCHAR2 | 1 | N |
| fdonatetype | 0捐赠款 1捐赠物 | VARCHAR2 | 1 | N |
| ftemplateid | 模板ID | VARCHAR2 | 32 | N |

---

### 2. UNE_CBILL_ITEM 电子票据明细表（官方表注释：电脑票明细，实测 33 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpid | 所属票据ID（逻辑关联 UNE_CBILL.fid） | VARCHAR2 | 32 | N |
| fsortno | 序号 | NUMBER | | N |
| fitemidcode | 项目识别码 | VARCHAR2 | 50 | N |
| fitemcode | 项目编码 | VARCHAR2 | 60 | N |
| fitemname | 项目名称 | VARCHAR2 | 200 | N |
| fitemstdidcode | 项目标准识别码 | VARCHAR2 | 50 | N |
| fitemstdcode | 项目标准编码 | VARCHAR2 | 60 | N |
| fitemstdname | 项目标准名称 | VARCHAR2 | 200 | N |
| funits | 计量单位 | VARCHAR2 | 32 | N |
| ffundsnature | 资金性质 | VARCHAR2 | 32 | N |
| fnumber | 执收数量 | NUMBER | [18,6] | N |
| fstd | 执收标准 | NUMBER | [18,6] | N |
| famt | 执收金额 | NUMBER | [18,6] | N |
| fpayableamt | 应缴金额 | NUMBER | [18,6] | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fcustom1 | 扩展字段 | VARCHAR2 | 120 | N |
| fcustom2 | 扩展字段 | VARCHAR2 | 4000 | N |
| fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |
| fcustom4~fcustom10 | 扩展字段 | VARCHAR2 | 200 | N |
| fitemsortid | 项目分类 | VARCHAR2 | 10 | N |
| fdate | 缴款日期 | VARCHAR2 | 10 | N |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 32 | N |

## 五、汇缴（票据流，生产库实测）

### 1. UNE_PAYBOOK 汇缴通知书主表（官方表注释：通知书，实测 130 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 32 | N |
| fagencode | 执收单位编码 | VARCHAR2 | 30 | N |
| fagenname | 执收单位名称 | VARCHAR2 | 200 | N |
| faccagenidcode | 缴款书执收单位识别码（有可能是代理单位） | VARCHAR2 | 50 | N |
| faccagencode | 缴款书执收单位编码（有可能是代理单位） | VARCHAR2 | 60 | N |
| faccagenname | 缴款书执收单位名称（有可能是代理单位） | VARCHAR2 | 200 | N |
| faccrgncode | | VARCHAR2 | 60 | N |
| faccrgnname | | VARCHAR2 | 60 | N |
| fplaceid | | VARCHAR2 | 32 | N |
| fplacecode | | VARCHAR2 | 60 | N |
| fplacename | | VARCHAR2 | 200 | N |
| fdate | 开单日期 | VARCHAR2 | 10 | N |
| fauthor | 开单人 | VARCHAR2 | 200 | N |
| fbillid | 票据ID | VARCHAR2 | 32 | N |
| fbillbatchcode | 等同于票据批次号 | VARCHAR2 | 60 | N |
| fbillno | 票据号 | VARCHAR2 | 20 | N |
| fmemo | 备注 | VARCHAR2 | 200 | N |
| fpayerid | 缴款人ID | VARCHAR2 | 32 | N |
| fpayername | 缴款人名称 | NVARCHAR2 | 240（字符） | N |
| fpayerno | 缴款人账号 | VARCHAR2 | 32 | N |
| fpayerbank | 缴款人开户银行 | VARCHAR2 | 60 | N |
| fpayertel | 缴款人电话 | VARCHAR2 | 74 | N |
| frecaccidcode | 收款账户识别码 | VARCHAR2 | 32 | N |
| frecaccbankid | 收款账户所属银行 | VARCHAR2 | 32 | N |
| frecname | 收款人全称 | VARCHAR2 | 100 | N |
| frecno | 收款人账号 | VARCHAR2 | 50 | N |
| frecbank | 收款人开户银行 | VARCHAR2 | 100 | N |
| frecacctype | 账户类型：1国库 2专户 3归集户 4单位汇缴户 5单位账户 | VARCHAR2 | 32 | N |
| fsecuritycode | 防篡改校验码 | VARCHAR2 | 60 | N |
| fcheckcode | 验证码 | VARCHAR2 | 20 | N |
| ftotalamt | 金额合计 | NUMBER | [18,6] | N |
| fbatchno | 批次号 | VARCHAR2 | 32 | N |
| feffdate | 缴款书有效期 | VARCHAR2 | 10 | N |
| fpaybooksource | 数据来源：1手工输入 2接口转入 | VARCHAR2 | 32 | N |
| fbustype | 缴款书业务类型：1直缴 2汇缴 | VARCHAR2 | 32 | N |
| fexternalid | 非手工录入的记录，通过服务或接口方式转入的 | VARCHAR2 | 50 | N |
| fpaycode | 为银行缴款用的（缴款码） | VARCHAR2 | 60 | N |
| fpaybatchcode | 为银行缴款用的缴款批次码 | VARCHAR2 | 50 | N |
| fstate | 缴款书状态：1正常 2作废（3已缴款确认；4电子转纸质已弃用） | VARCHAR2 | 1 | N |
| fissign | | VARCHAR2 | 2 | N |
| fprintnumber | 打印白纸，记一下打印次数 | NUMBER | | N |
| fconfirmdate | 缴款确认日期 | VARCHAR2 | 10 | N |
| freceivedate | 到账确认日期 | VARCHAR2 | 10 | N |
| fcustom1~fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |
| fcustom4~fcustom30 | 扩展字段 | VARCHAR2 | 200 | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fisfinal | 新增缴款的默认标识为1，取缴款信息时，加个这个条件 | VARCHAR2 | 2 | N |
| fpaybillid | 缴款书表的票据 | VARCHAR2 | 32 | N |
| fpaybillbatchcode | 缴款书表的票据 | VARCHAR2 | 60 | N |
| fpaybillno | 缴款书表的票据 | VARCHAR2 | 30 | N |
| fcompbillid | 纸质票ID | VARCHAR2 | 32 | N |
| fcompbillbatchcode | 纸质票批次号 | VARCHAR2 | 60 | N |
| fcompbillno | 纸质票号 | VARCHAR2 | 30 | N |
| fsoftwareversion | 软件版本：Treasury财政部版 / General通用版 / Fujian福建 | VARCHAR2 | 20 | N |
| fpaymode | 缴款渠道：网上缴款、柜台缴款、pos等 | VARCHAR2 | 2 | N |
| frecmode_treasury | 1现金 2POS（Treasury 版扩展） | VARCHAR2 | 32 | N |
| fisamt_treasury | 是否：财政部里，表示收现金或转账 | VARCHAR2 | 32 | N |
| fcbillid_treasury | 已转入到电脑开票，登记电脑开票的id | VARCHAR2 | 32 | N |
| fpaybooksignature_treasury | 财政部生成缴款书以后先签名，转存电子凭证库（保存后自动生成） | BLOB | | N |
| fbillsignature_treasury | 财政部缴款确认后开的电子收据，签名后转存电子凭证库及电子存证（缴款确认后生成） | BLOB | | N |
| freceiptno_treasury | 收据号（Treasury 版扩展） | VARCHAR2 | 30 | N |
| fpaybankrange_treasury | | VARCHAR2 | 2 | N |
| fismatchtemporary | 银行发起暂存款匹配缴款书，单位端自动确认暂存款的标识 | VARCHAR2 | 2 | N |
| fpospushstate | POS 推送状态 | VARCHAR2 | 1 | N |
| fposabnormal | POS 异常标记 | VARCHAR2 | 2 | N |
| fpayplanbatchno | 划缴批次号 | VARCHAR2 | 32 | N |
| fpayplandate | 划缴编制日期 | VARCHAR2 | 10 | N |
| fpayplanoper | 划缴人 | VARCHAR2 | 100 | N |
| fpayplanorderdate | 预约划缴日期 | VARCHAR2 | 10 | N |
| fpayplanstate | 划缴状态 | VARCHAR2 | 2 | N |
| fpayplanresult | 划缴结果 | VARCHAR2 | 200 | N |
| fnontaxreceive | 非税接收 | VARCHAR2 | 2 | N |
| fpayeraccname | 付款人户名 | VARCHAR2 | 100 | N |
| frecaccname | 收款人户名 | VARCHAR2 | 100 | N |
| fvirtualaccount | 虚拟子账户 | VARCHAR2 | 2 | N |
| fbatchimportno | 批导批次号 | VARCHAR2 | 64 | N |
| fchangemorebill | 换开多张票 | VARCHAR2 | 2 | N |
| fpayerbankid | 缴款人所属银行 | VARCHAR2 | 32 | N |
| frowpayagreement | 划缴协议号 | VARCHAR2 | 100 | N |
| fpayercertificate | 缴款人证件号 | VARCHAR2 | 100 | N |
| fbusinesstype | 业务类型（3位，未注释，与 fbustype 并存） | VARCHAR2 | 3 | N |
| fcomcbillid | 电脑开票表的票据（电子票），指向 UNE_CBILL | VARCHAR2 | 32 | N |
| fcomcbillbatchcode | 电脑开票表的票据（电子票） | VARCHAR2 | 60 | N |
| fcomcbillno | 电脑开票表的票据（电子票） | VARCHAR2 | 30 | N |
| fpayeremail | 邮箱 | VARCHAR2 | 30 | N |
| fcreditcode | 组织机构代码/统一社会信用代码 | VARCHAR2 | 426 | N |
| fcollectpaycode | 对应汇总缴款书的缴款码 | VARCHAR2 | 60 | N |
| fisverificate | 是否已审验 | VARCHAR2 | 1 | N |
| foutordertime | 通缴云下单时间，格式yyyyMMddHHmmss | VARCHAR2 | 15 | N |
| fbelongrgncode | 缴库级次 | VARCHAR2 | 32 | N |
| finvalidmemo | 作废说明 | VARCHAR2 | 200 | N |
| fbelongtype | 分成性质：1常规 2扩展类型（口岸类） | VARCHAR2 | 2 | N |
| fisbillfeebalance | 是否工本费结算（1是 0否） | VARCHAR2 | 1 | N |
| fconfirmurl | 缴款确认地址（用于访问独立部署单位进行缴款确认） | VARCHAR2 | 200 | N |
| frefundamt | 退付金额 | NUMBER | [18,6] | N |
| frefundstate | 退付状态 | CHAR | 1 | N |
| fnewpaycode | 作废重开缴款码 | VARCHAR2 | 60 | N |

---

### 2. UNE_PAYBOOK_ITEM 汇缴通知书明细表（官方表注释：通知书明细，实测 32 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpid | 所属通知书ID（逻辑关联 UNE_PAYBOOK.fid） | VARCHAR2 | 32 | N |
| fsortno | 序号 | NUMBER | | N |
| fitemidcode | 项目识别码 | VARCHAR2 | 50 | N |
| fitemcode | 项目编码 | VARCHAR2 | 60 | N |
| fitemname | 项目名称 | VARCHAR2 | 200 | N |
| fitemstdidcode | 项目标准识别码 | VARCHAR2 | 50 | N |
| fitemstdcode | 项目标准编码 | VARCHAR2 | 60 | N |
| fitemstdname | 项目标准名称 | VARCHAR2 | 200 | N |
| funits | 计量单位 | VARCHAR2 | 32 | N |
| ffundsnature | 资金性质 | VARCHAR2 | 32 | N |
| fnumber | 执收数量 | NUMBER | [18,6] | N |
| fstd | 执收标准 | NUMBER | [18,6] | N |
| famt | 执收金额 | NUMBER | [18,6] | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fcustom1~fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |
| fcustom4~fcustom10 | 扩展字段 | VARCHAR2 | 200 | N |
| fitemsortid | 项目分类 | VARCHAR2 | 10 | N |
| fdate | 缴款日期 | VARCHAR2 | 10 | N |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 32 | N |

---

### 3. UNE_PAYBOOK_CONFIRM 收款确认表（官方表注释：通知书，实测 25 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fbillbatchcode | 等同于票据批次号 | VARCHAR2 | 60 | N |
| fbillno | 票据号 | VARCHAR2 | 20 | N |
| fpaycode | 为银行缴款用的（缴款码，本表靠缴款码+票据号关联通知书，无 fpid） | VARCHAR2 | 50 | N |
| fconfirmcode | 确认码 | VARCHAR2 | 50 | N |
| fconfirmdate | 确认日期 | VARCHAR2 | 10 | N |
| fconfirmer | 确认人 | VARCHAR2 | 60 | N |
| fpaymode | 缴款渠道 | VARCHAR2 | 32 | N |
| ftotalamt | 金额合计 | NUMBER | | N |
| fbankoutlet | 银行网点编码 | VARCHAR2 | 50 | N |
| freveive | 资金到账情况 | NUMBER | 1 | N |
| frecacctype | 账户类型：1国库 2专户 3归集户 4单位汇缴户 5单位账户 | VARCHAR2 | 32 | N |
| frecname | 收款人全称 | VARCHAR2 | 200 | N |
| frecno | 收款人账号 | VARCHAR2 | 50 | N |
| frecbank | 收款人开户银行 | VARCHAR2 | 60 | N |
| fversion | 版本号 | NUMBER | | N |
| fappsrc | 来源：1银行 2其他 | VARCHAR2 | 2 | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| frecbankcode | 缴款银行 | VARCHAR2 | 50 | N |
| fdatasrc | 在线且属于下级数据为1，其余为0（1为需同步到下线 0则无需） | VARCHAR2 | 1 | N |
| ftranobus | 确认交易流水号 | VARCHAR2 | 50 | N |
| fbusinessno | 支付订单号 | VARCHAR2 | 200 | N |
| fconfirmtime | 缴款确认时间 | VARCHAR2 | 19 | N |

## 六、冲红、遗失、作废（票据流，生产库实测）

### 1. UNE_WRITEOFF 冲红信息表（官方表注释：冲销信息，实测 30 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fno | 单号 | VARCHAR2 | 20 | N |
| foldbillid | 被冲销票据ID（旧票） | VARCHAR2 | 32 | N |
| foldbillbatchcode | 等同于票据批次号 | VARCHAR2 | 60 | N |
| foldbillno | 被冲销票据号（旧票） | VARCHAR2 | 20 | N |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 50 | N |
| faccagenidcode | | VARCHAR2 | 50 | N |
| fplaceid | | VARCHAR2 | 32 | N |
| fdate | 冲销日期 | VARCHAR2 | 10 | N |
| fpayername | 缴款人名称 | VARCHAR2 | 120 | N |
| ftotalamt | 金额合计 | NUMBER | [18,6] | N |
| fauthor | 经办人 | VARCHAR2 | 200 | N |
| fmemo | 备注 | VARCHAR2 | 255 | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fcustom1~fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |
| fstate | 票据状态：1正常 2作废 | VARCHAR2 | 32 | N |
| fbillid | 票据ID | VARCHAR2 | 32 | N |
| fbillbatchcode | 票据批次号 | VARCHAR2 | 60 | N |
| fbillno | 票据号 | VARCHAR2 | 30 | N |
| fnewbillid | 新开票据ID（红票） | VARCHAR2 | 32 | N |
| fnewbillbatchcode | 新开票据批次号 | VARCHAR2 | 60 | N |
| fnewbillno | 新开票据号 | VARCHAR2 | 30 | N |
| fnewbilltotalamt | 新开票据金额 | NUMBER | [18,6] | N |
| freasontype | 冲销原因类型：1票面信息错误 2退费 3其他 | VARCHAR2 | 10 | N |

---

### 2. UNE_HBILL 手工票据表（官方表注释：手写票，实测 31 列，本库无数据）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fno | 单号 | VARCHAR2 | 20 | N |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 50 | N |
| faccagenidcode | | VARCHAR2 | 50 | N |
| fplaceid | | VARCHAR2 | 32 | N |
| fpayername | 缴款人名称 | VARCHAR2 | 120 | N |
| fdate | 开单日期 | VARCHAR2 | 10 | N |
| fauthor | 开票人 | VARCHAR2 | 200 | N |
| fbillid | 票据ID | VARCHAR2 | 32 | N |
| fbillbatchcode | 票据批次号 | VARCHAR2 | 60 | N |
| fbillno1 | 起始票号（号段） | VARCHAR2 | 20 | N |
| fbillno2 | 截止票号（号段） | VARCHAR2 | 20 | N |
| fdate1 | 起始日期 | VARCHAR2 | 10 | N |
| fdate2 | 截止日期 | VARCHAR2 | 10 | N |
| fnumber | 数量（本段票据张数） | NUMBER | [18,6] | N |
| ftotalamt | 金额合计 | NUMBER | [18,6] | N |
| fmemo | 备注 | VARCHAR2 | 255 | N |
| fbatchno | 批次号 | VARCHAR2 | 32 | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fcustom1~fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |
| fchangestate | 审核状态 | VARCHAR2 | 32 | N |
| fchangedate | 审核日期 | VARCHAR2 | 10 | N |
| fchangeman | 审核人 | VARCHAR2 | 200 | N |
| fchangesitu | 审核情况 | VARCHAR2 | 200 | N |

---

### 3. UNE_HBILL_ITEM 手工票据明细表（官方表注释：手写票明细，实测 20 列，本库无数据）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpid | 所属手工票ID（逻辑关联 UNE_HBILL.fid） | VARCHAR2 | 32 | N |
| fsortno | 序号 | NUMBER | | N |
| fitemidcode | 项目识别码 | VARCHAR2 | 50 | N |
| fitemcode | 项目编码 | VARCHAR2 | 60 | N |
| fitemname | 项目名称 | VARCHAR2 | 200 | N |
| funits | 计量单位 | VARCHAR2 | 50 | N |
| ffundsnature | 资金性质 | VARCHAR2 | 32 | N |
| fnumber | 执收数量 | NUMBER | [18,6] | N |
| fstd | 执收标准 | NUMBER | [18,6] | N |
| famt | 执收金额 | NUMBER | [18,6] | N |
| fpayableamt | 应缴金额 | NUMBER | [18,6] | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fcustom1~fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |
| fbatchno | 批次号 | VARCHAR2 | 32 | N |

---

### 4. UBE_STOCK_INVALID 票据库存作废主表（官方表注释：未使用票据作废，实测 21 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fno | 单号（作废申请单号） | VARCHAR2 | 20 | N |
| frgncode | 区划编码 | VARCHAR2 | 60 | N |
| fagenidcode | 执收单位识别码 | VARCHAR2 | 50 | N |
| fplaceid | | VARCHAR2 | 32 | N |
| fdate | 申请日期 | VARCHAR2 | 10 | N |
| finvalidtype | 作废类型：1空白 2遗失 | VARCHAR2 | 32 | N |
| foperator | 经办人 | VARCHAR2 | 200 | N |
| fauthor | 申请人 | VARCHAR2 | 200 | N |
| fmemo | 备注 | VARCHAR2 | 255 | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型：1新增 2修改 3删除 | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |
| fchangestate | 审核状态：0未审核 1审核通过 2未通过 3无需审核 | VARCHAR2 | 32 | N |
| fchangedate | 审核日期 | VARCHAR2 | 10 | N |
| fchangeman | 审核人 | VARCHAR2 | 200 | N |
| fchangesitu | 审核情况 | VARCHAR2 | 200 | N |
| fcustom1~fcustom3 | 扩展字段 | VARCHAR2 | 120 | N |

---

### 5. UBE_STOCK_INVALID_ITEM 票据库存作废明细表（实测 11 列）

| 字段名 | 字段中文名称 | 数据类型 | 数据长度 | 强制 |
|---|---|---|---|---|
| fid | 记录ID，主键 | VARCHAR2 | 32 | Y |
| fpid | 所属作废申请ID（逻辑关联 UBE_STOCK_INVALID.fid） | VARCHAR2 | 32 | N |
| fbillid | 票据ID | VARCHAR2 | 32 | N |
| fbillbatchcode | 票据批次号 | VARCHAR2 | 50 | N |
| fnumber | 数量（号段内票据张数） | NUMBER | [18,6] | N |
| fbillno1 | 起始票号（号段） | VARCHAR2 | 20 | N |
| fbillno2 | 截止票号（号段） | VARCHAR2 | 20 | N |
| fversion | 版本号 | NUMBER | | N |
| faltercode | 变更类型（见数据字典：1新增 2修改） | VARCHAR2 | 32 | N |
| fcreatetime | 创建时间 | VARCHAR2 | 17 | N |
| fupdatetime | 更新时间 | VARCHAR2 | 17 | N |