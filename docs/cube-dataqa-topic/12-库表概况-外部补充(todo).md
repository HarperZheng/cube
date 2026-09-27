# 第一章：数据库所有表的作用

该数据库以**资金收付、清分划拨、开票、汇缴以及冲红/遗失/作废**为主线，Oracle 源表主要分为六个业务环节。

### 1. 资金收缴

| 表                    | 作用                                       |
| -------------------- | ---------------------------------------- |
| **FNE_PAYBOOK**      | 财政缴款书主表，记录资金收缴业务的主单据，是收缴数据的起点。           |
| **FNE_PAYBOOK_ITEM** | 财政缴款书明细表，与 FNE_PAYBOOK 对应，记录一张缴款书下的具体明细。 |

**关系：**
FNE_PAYBOOK → FNE_PAYBOOK_ITEM，为 **1:N**，通过 **FPID** 关联。

---

### 2. 清分划拨

| 表                           | 作用                                            |
| --------------------------- | --------------------------------------------- |
| **FNE_FUNDDIVIDE**          | 资金分解明细表，对收缴资金进行资金归属、分解，是清分处理的核心表。             |
| **FNE_COLLECT_TO_TRANSFER** | 汇总划拨流水表，将收缴资金汇总后形成待划拨数据，并通过 FTRANSNO 与划拨数据关联。 |
| **FNE_TRANSFER_COLLECT**    | 划拨汇总表，对划拨相关收缴数据进行汇总，形成划拨侧的汇总结果。               |
| **FNE_CAPITAL_TRANSFER**    | 资金划转主表，记录实际资金划转业务及划转批次。                       |
| **FNE_TRANSFER_BANK_MSG**   | 商业银行资金划转表，记录银行侧资金划转信息，与资金划转主表形成对应关系。          |

**整体作用：**

> FNE_PAYBOOK / FNE_PAYBOOK_ITEM 产生收缴数据 → FNE_FUNDDIVIDE 对资金进行分解 → FNE_COLLECT_TO_TRANSFER、FNE_TRANSFER_COLLECT 形成划拨汇总 → FNE_CAPITAL_TRANSFER 形成资金划转 → FNE_TRANSFER_BANK_MSG 记录银行划转信息。

其中，**FTRANSNO** 是划拨/划转链路中的重要业务关联号。

---

### 3. 资金缴库

| 表                              | 作用                           |
| ------------------------------ | ---------------------------- |
| **FNE_TREASURY_TRANSFER**      | 资金缴库主表，记录资金从划拨环节进入国库的缴库业务。   |
| **FNE_TREASURY_TRANSFER_ITEM** | 资金缴库明细表，记录一笔缴库业务对应的具体资金明细。   |
| **FNE_TREASURY_TRANSFER_MSG**  | 缴库资金划转信息表，记录缴库过程中的资金划转/报文信息。 |

**关系：**

> FNE_TREASURY_TRANSFER → FNE_TREASURY_TRANSFER_ITEM → FNE_TREASURY_TRANSFER_MSG

三者分别承担**缴库主单、缴库明细、缴库划转信息**的职责。

---

### 4. 开具票据

| 表                  | 作用                     |
| ------------------ | ---------------------- |
| **UNE_CBILL**      | 电子票据主表，记录电子票据的基本信息。    |
| **UNE_CBILL_ITEM** | 电子票据明细表，记录电子票据对应的具体明细。 |

**关系：**

UNE_CBILL → UNE_CBILL_ITEM，为 **1:N**，通过 **FPID** 关联。

---

### 5. 汇缴

| 表                       | 作用                           |
| ----------------------- | ---------------------------- |
| **UNE_PAYBOOK**         | 汇缴通知书主表，记录汇缴通知书及其与电子票据的关联信息。 |
| **UNE_PAYBOOK_ITEM**    | 汇缴通知书明细表，记录汇缴通知书中的具体资金/票据信息。 |
| **UNE_PAYBOOK_CONFIRM** | 收款确认表，记录汇缴业务的收款确认结果。         |

**关系：**

> UNE_PAYBOOK → UNE_PAYBOOK_ITEM → UNE_PAYBOOK_CONFIRM

其中 UNE_PAYBOOK_ITEM 与 UNE_PAYBOOK_CONFIRM 通过 **FPAYCODE** 等业务标识关联。

---

### 6. 冲红、遗失、作废

| 表                          | 作用                        |
| -------------------------- | ------------------------- |
| **UNE_WRITEOFF**           | 冲红/冲销信息表，记录票据冲红、冲销等业务。    |
| **UNE_HBILL_ITEM**         | 手工票据明细表，记录手工开具票据的明细数据。    |
| **UBE_STOCK_INVALID**      | 票据库存作废表，记录未开票/未使用票据的作废信息。 |
| **UBE_STOCK_INVALID_ITEM** | 票据库存作废明细表，记录具体被作废的票据。     |

其中：

> UBE_STOCK_INVALID → UBE_STOCK_INVALID_ITEM

通过 **FPID** 建立主表与明细表关系。

---

# 第二章：表之间的整体关系

整个数据库可以概括为一条完整的**资金收缴 → 清分 → 划拨 → 缴库 → 开票/汇缴 → 后续票据处理**业务链。

```text
资金收缴
FNE_PAYBOOK
    │ 1:N FPID
    ▼
FNE_PAYBOOK_ITEM
    │
    ▼
清分划拨
FNE_FUNDDIVIDE
    │
    ├── FNE_COLLECT_TO_TRANSFER
    │          │
    │          ▼
    │    FNE_TRANSFER_COLLECT
    │
    └──────────────► FNE_CAPITAL_TRANSFER
                         │ 1:N FTRANSNO
                         ▼
                  FNE_TRANSFER_BANK_MSG
                         │
                         ▼
                    资金缴库
              FNE_TREASURY_TRANSFER
                         │
                    1:N FPARENTID
                         ▼
              FNE_TREASURY_TRANSFER_ITEM
                         │
                    1:N FTRANSNO
                         ▼
              FNE_TREASURY_TRANSFER_MSG
```

票据侧形成另一条业务链：

```text
开具票据
UNE_CBILL
    │ 1:N FPID
    ▼
UNE_CBILL_ITEM


汇缴
UNE_PAYBOOK
    │ 1:N FPID
    ▼
UNE_PAYBOOK_ITEM
    │
    ▼
UNE_PAYBOOK_CONFIRM
```

同时，票据生命周期还存在后续处理：

```text
UNE_PAYBOOK / UNE_CBILL
        │
        ├──────────► UNE_WRITEOFF
        │              冲红/冲销
        │
        └──────────► UBE_STOCK_INVALID
                       │ 1:N FPID
                       ▼
                 UBE_STOCK_INVALID_ITEM
                       票据作废
```

### 核心关联键

| 关联键                                 | 主要作用                         |
| ----------------------------------- | ---------------------------- |
| **FPID**                            | 贯穿缴款书、票据、明细等主从表，是最主要的主单据关联键。 |
| **FPARENTID**                       | 资金缴库主表与缴库明细之间的父子关系。          |
| **FTRANSNO**                        | 资金划拨、银行划转、缴库等环节之间的资金交易关联号。   |
| **FPAYCODE**                        | 汇缴通知、收款确认等票据/收款业务之间的关联标识。    |
| **FCOMCBILLID**                     | 汇缴通知书与电子票据之间的业务关联标识。         |
| **FTRANSNO → FNE_CAPITAL_TRANSFER** | 将清分/划拨侧数据与实际资金划转主表连接起来。      |

从业务模型看，这些表并非彼此独立，而是围绕三个核心对象展开：**资金单据（Paybook）—资金流转（Transfer/Treasury）—票据（CBill/Paybook）**。其中 **FPID、FTRANSNO、FPAYCODE** 分别承担单据、资金交易和票据/收款业务在不同业务阶段之间的串联作用。
