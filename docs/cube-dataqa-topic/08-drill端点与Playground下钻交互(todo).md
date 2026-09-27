# 08 drill 端点与 Playground 下钻交互（/v1/drill）

> 用途一句话：**drill_members 是"下钻说明书"，/v1/drill 是"下钻拼装器"**——
> 开源 Core 只有说明书（声明有效），没有拼装器（端点不存在，实测
> Cannot POST）；本文记录端点补齐后 Playground 会出现的 Drill Down 交互，
> 作为 01 设计开发完成后的待办功能。
> **2026-09-23 讨论定案**：注入式增强 / 自绘 Modal / 一期仅表格单元格——
> 实施设计（列映射策略、降级矩阵、测试用例）见第五节，可据此动手。
> 实际文件：[cbill.yml](../../conf/model/cubes/facts_cbill/cbill.yml)、
> [stock.yml](../../conf/model/cubes/facts_stock/stock.yml)（drill_members 声明处）。

---

## 一、现状（开源 Core 1.7.42，已实测）

| 环节 | 状态 |
|---|---|
| `drill_members` 模型声明 | ✅ 有效——cbill.receipt_count / stock_out.out_count / stock_in.in_count / stock_apply.apply_count / suspicious.suspicious_count / stock.stock_count 主度量已声明，annotation 实测回显 `drillMembers` / `drillMembersGrouped` |
| 视图成员 annotation | ✅ 实测携带（2026-09-23）——usage_view.receipt_count 回显 drillMembers 且**反别名回视图命名空间**，view 主查询形态零兜底直接可用（见 5.1 事实 1） |
| `/v1/drill` REST 端点 | ❌ 不存在——`POST /cubejs-api/v1/drill` 实测返回 `Cannot POST` |
| Playground #/build 一键下钻 | ❌ 无——build 页不渲染 drillMembers 元数据，"点击单元格出明细"交互不存在 |
| REST / AI 代理下钻 | ✅ 兜底可用——2.1 join 查询 / 2.3 两步查询（见 06 文档），客户端自己拼 |

分工：**声明（drill_members）+ 执行（/v1/drill）= 完整的点击下钻**。本项目
已做完全部模型层工作，缺的只是服务端拼装这半个环节。

## 二、有了 /v1/drill 后，Playground 会出现什么

### 2.1 表格视图：数字变成"可点开的"

```
┌─────────────────────────────────────────────┐
│ 单位名称           │ 库存段数               │
│ 测试测试环境0115   │   109   ←─ 悬停出现提示  │
│ 发展改革委员会     │    53                  │
└─────────────────────────────────────────────┘
        │
        ▼ 点击「109」单元格
┌─────────────────────────────────────────────┐
│  ▸ Drill Down    （菜单项）                  │
└─────────────────────────────────────────────┘
        │
        ▼ 选择 Drill Down
   新查询 tab 自动打开（不需要用户填任何字段）：
   - filters 自动带上：agency.name = '测试测试环境0115'
   - dimensions 自动带上：drillMembers 声明的字段
     （bill_type.name, bill_no1, bill_no2）
   - 立即执行，返回这 109 段的明细行
```

### 2.2 图表视图：同理

点击柱状图的某根柱子 / 折线的某个点 → 该系列对应的过滤上下文
（如 `bill_month = 2026-09`、`agency.name = xxx`）自动变成 filters →
弹出明细。

### 2.3 交互的三个特征

| 特征 | 说明 |
|---|---|
| **零配置交互** | 用户不填字段、不写查询；模型声明（drill_members）+ 服务端拼装（/v1/drill）自动完成。每个度量"点开看什么"由模型决定，不由看板开发者硬编码 |
| **逐层下钻** | 明细结果的单元格还能继续点（若那行的度量也有下钻口径），形成"数字 → 构成 → 更细构成"的逐层探索 |
| **上下文自动继承** | 第一屏查询带的过滤条件（时间范围、区划）在下钻时自动保留，用户不会"跳出去"丢上下文 |

## 三、补齐路径（已定方案：注入式 Playground 增强）

> **前提修正（2026-09 全量扫描 bundle 证实）**：缺的不只是 `/v1/drill` 端点——
> 1.7.42 Playground 前端 bundle 里 "Drill down" 菜单文案不存在、
> `onQueryDrilldown` 回调 0 处调用方、`resultSet.drillDown()` 0 处调用、
> `DrilldownModal` 仅被 Vizard 代码模板引用。**补端点不会让交互出现**，
> 缺的是前端接线，而 bundle 是压缩产物不可维护地改。

> **关键澄清（2026-09-23）**：`/v1/drill` 端点可以**永远不做**——
> `resultSet.drillDown()` 本质是纯客户端查询变换（返回新 query 对象，再用普通
> /v1/load 执行），不依赖任何服务端端点。整套下钻 = 客户端拼装，零服务端改动。

**约束**：不新增页面、交互必须出现在现有 Playground #/build 内、
不碰 cube 源码与压缩 bundle、不重建镜像（volume 挂载覆盖）。

### 改造点（3 处，目录 `playground-ext/` 与 docker-compose.yml 同级）

| # | 文件 | 作用 |
|---|---|---|
| 1 | `playground-ext/ext-drill.js` | 下钻交互脚本（核心），见下方技术路线 |
| 2 | `playground-ext/index.html` | 镜像内原 index.html 的副本 + `</body>` 前注入 `<script src="/ext-drill.js"></script>` |
| 3 | `docker-compose.yml` | volumes 新增两条挂载，覆盖镜像内 playground 文件 |

### ext-drill.js 技术路线（全部在 bundle 之外）

| 环节 | 做法 | 可行性依据（已实测） |
|---|---|---|
| 拿到当前查询 | 包装 `window.fetch`，拦截发往 `/cubejs-api/v1/load` 的请求体 + 响应 annotation（取 `drillMembers`） | bundle 内 `fetch(` 26 处，主客户端走 fetch；覆盖 fetch 对页面透明 |
| 兜底拿查询 | 从 localStorage 读 query tabs | bundle 有 8 处 localStorage 引用 |
| 交互接线 | MutationObserver 监听结果表格，给数据单元格绑点击 | — |
| 拼下钻查询 | 等价实现客户端 `drillDown()`：drillMembers→dimensions、单元格值→filters(equals)、timeDimensions 粒度→dateRange、继承原 filters/segments/timezone | 拼法即 06 文档 2.1/2.3，已验证 |
| 展示明细 | 自绘 modal（样式对齐 antd），明细行可继续点击 → 逐层下钻 | 行为参考 DrilldownModal |

### docker-compose.yml 挂载

```yaml
volumes:
  - ./playground-ext/index.html:/cube/node_modules/@cubejs-backend/server-core/playground/index.html:ro
  - ./playground-ext/ext-drill.js:/cube/node_modules/@cubejs-backend/server-core/playground/ext-drill.js:ro
```

### 分期与权衡

- **第一期只做表格视图下钻**（数字单元格点击）；图表是 canvas 按坐标
  换算，复杂度高，后评估
- 升级镜像后 index.html 内资源 hash 会变，副本需重新生成（拉原文件→
  追加 script 标签，可脚本化，每次升级跑一次）
- 脚本依赖 DOM 结构，Cube 大版本 UI 重写时需适配
- 稳定后可选：把 playground-ext/ COPY 进 Dockerfile 固化到镜像，
  去掉挂载（开发期保留挂载便于热改）

### 备选路径（保留参考）

| 方案 | 说明 | 评估 |
|---|---|---|
| A. 升级镜像 | 迁移/升级到 Playground 自带下钻交互的版本 | 模型层零改造；但需先验证目标版本确有此 UI，且 Oracle 驱动/模型整体回归，成本与收益倒挂 |
| B. 补丁实现 `/v1/drill` 端点 | preload.js/agent 侧转发拼 query → /v1/load | **已被前提修正否决**：端点补了前端也不接线 |
| C. 自定义前端拼 | BI 前端读 annotation.drillMembers 自拼下钻查询 | 仍是 REST/AI 代理路径的现行做法（06 文档 2.1/2.3），与注入方案并存 |

## 四、与本项目 drill 方案的关系

- 模型层（drill_members 声明）已全部就绪——见各主度量的
  `drill_members: [...]`，annotation 回显已实测；
- 现阶段下钻的可用路径：**人**在 Playground 手动组合（P5 view 把点选成本
  降到最低）+ **程序**（REST/AI 代理）走 06 文档 2.1/2.3 拼法；
- 本端点属于"锦上添花"：补上后 Playground 从"手动组合"升级为"一键下钻"，
  不补也不影响任何口径与数据正确性。

## 五、实施设计定案（2026-09-23 讨论）

> 三项决策：展示形态=**自绘 Modal**（非 tab 注入）；一期范围=**仅表格单元格**；
> 本节回填即定稿，评审通过后动手实现。

### 5.1 实测新事实（2026-09-23，两条）

1. **视图成员 annotation 完整携带 drillMembers**：`usage_view.receipt_count`
   回显 `drillMembers: [usage_view.bill_no, usage_view.item_name, usage_view.item_code]`，
   且成员名自动**反别名回视图命名空间**（`cbill_item.item_name` →
   `usage_view.item_name`，见 transformedQuery.allBackAliasMembers）——
   P5 后的主查询形态（view）**不需要 /v1/meta 兜底映射**，下钻声明直接可用
2. **挂载路径确认**：`server-core/playground/index.html` 存在，旁边 `vizard/`
   即 DrilldownModal 模板引用处，自绘行为有现成代码可抄

### 5.2 环节拆解（按难度排序）

| 环节 | 做法 | 难度 |
|---|---|---|
| ① 拿查询+声明 | 包装 `window.fetch` 拦截 /v1/load 请求体与响应，存 `(query, annotation, data原始值)` | 低（主客户端走 fetch 已确认） |
| ② **单元格→成员映射** | 见 5.3——**唯一脆弱点** | **最高** |
| ③ 下钻查询拼装 | drillMembers→dimensions；行内维度值→`equals` filters；时间维度粒度→该桶 dateRange；继承原 filters（含 AND/OR 嵌套）/segments/timezone；limit 1000（**请求不能带 rowLimit**，实测网关拒绝） | 低（06 文档 2.1 拼法） |
| ④ 展示+递归 | 自绘 Modal（样式对齐 antd），行内值可点→加 filter 重查（切片），面包屑栈 | 中 |
| ⑤ 接线进页面 | index.html 副本 + `</body>` 前注入 script 标签 + compose 两条 ro 挂载 + sync 脚本（升级镜像后重跑） | 低 |

### 5.3 列映射策略（环节②，最难点的解法）

- **列 ↔ 成员**：annotation 的 title（中文精选名，基本唯一）匹配表头；
  列序（query.measures + dimensions 顺序）兜底
- **行值 ↔ 数据**：直接用 ① 截获的响应**原始值**，不解析 DOM 显示文本——
  时间粒度单元格显示的是格式化文本（如 Sep 2026），原始值是 ISO 串
- **行 ↔ 数据行**：DOM 行位置对应 data 数组下标；last-response-wins
  （Playground 切 tab 会重新发 load，截获响应即当前显示）

### 5.4 降级矩阵（提前定，提示而非静默失败）

| 场景 | 一期行为 |
|---|---|
| 透视（Pivot）模式 | 检测到两级表头 → 禁用下钻，悬停提示"透视模式暂不支持下钻" |
| 图表视图 | 不绑点击（canvas 坐标换算留二期） |
| 未声明 drill_members 的度量单元格 | 无悬停无点击，no-op |
| ungrouped 查询 | 已是原始行，无下钻意义，禁用 |
| 自定义时间粒度（非 day/week/month/quarter/year） | 不识别桶边界 → 禁用 |

### 5.5 预期边界（写进预期，不当缺陷）

- 下钻查询（dimensions=drillMembers）大概率**不命中预聚合**（P6 已实测单票
  下钻不命中，raw 兜底）——千行级 Oracle latency 可接受
- 行级权限对下钻查询**自动生效**（同一 cube 同一策略，Security Context
  继承）——Cube 层执行权限的好处，无需额外处理

### 5.6 测试用例（真实数据）

| # | 查询 | 操作 | 预期 |
|---|---|---|---|
| 1 | stock.stock_count 按单位分组 | 点「109」单元格 | modal 返回 109 段明细（票种/票据号1/票据号2）——第二节 2.1 原例 |
| 2 | cbill.receipt_count 按月 | 点 2026-09 | 该月开票明细（bill_no/item_name/item_code），验证时间粒度→dateRange；行数=票×项目明细粒度（实测 75），比单元格去重票数（73）多 2 是一票多项目的正确下钻语义，非缺陷 |
| 3 | 带 Security Context（JWT 530100）查询 | 下钻 | 明细同样按行权限收窄（自动生效，无需处理） |
| 4 | usage_view.receipt_count 查询 | 下钻 | view 主形态直接可用（5.1 事实 1） |
| 5 | 任意查询开透视 / 切到 Chart | 悬停/点击 | 按降级矩阵提示，不静默失败 |

### 5.7 实施记录（2026-09-23）

三件套已落盘并挂载生效（容器 Recreate，镜像不动）：

| 文件 | 状态 |
|---|---|
| `playground-ext/ext-drill.js` | ✅ 核心脚本（约 800 行）：fetch 拦截 + 列映射（div 网格）+ 查询拼装 + Modal 切片 + 降级矩阵 |
| `playground-ext/index.html` | ✅ 镜像原文件副本 + `</body>` 前注入 script 标签（2225 字节） |
| `playground-ext/sync-index.sh` | ✅ 升级镜像后重新生成副本——用临时容器从**镜像**拉原文件（挂载生效后 exec 读到的是旧挂载副本，会错过新版本） |
| `docker-compose.yml` | ✅ 新增两条 ro 挂载，覆盖 playground 两文件 |

**实测发现（实施期新增）**：

1. **请求不能带 `rowLimit`**——API 网关拒绝（"rowLimit" is not allowed）；响应里回显的
   rowLimit 是服务端内部加的。下钻查询只用 `limit: 1000`
2. **`{dimension}` 无粒度原始列合法**——drillMembers 含时间维度成员（stock_in.in_date
   等）时以 `timeDimensions: [{dimension}]` 形态出列，实测 OK
3. **下钻行数语义**：countDistinct 度量的下钻行数 = drillMembers 明细粒度行数，比单元格
   值大是正确语义（用例 2 实测 75 vs 73，去重票号数=73 确认）
4. **本版 Playground 走 GET 查询 + 新响应格式**——页面客户端发
   `GET /cubejs-api/v1/load?query=...&queryType=multi`（非 POST body），响应为
   `{ queryType, results: [{ query, annotation, data }], pivotQuery, slowQuery }`
   多查询结构，数据在 `results[0]`；旧格式 `{ query, annotation, data }`（直连 curl）
   两者兼容处理
5. **结果区是 styled-components div 网格，不是 `<table>`**——类名为构建期哈希
   （`sc-*`）不可依赖；表头文本被拆成多个叶子 span 且嵌套 3 层同文本容器
   （SPAN < label div < header cell）；数据行是无类名 wrapper（孩子为无类名 cell
   div）。列定位靠 annotation 成员标题做**容器级** squash 匹配（去空白+去点）+
   **同文本祖先链顶**上溯；schema 侧边栏的同名成员按钮会干扰匹配，最终靠
   "簇内数据行必须能匹配拦截数据" 决定性排除
6. **冻结列（pinned columns）拆簇**——查询 ≥3 列时 Playground 渲染冻结列布局：
   维度表头被装进行容器内 `UL.sc-dovzVR`（行容器的后代），度量表头仍是行容器
   直接孩子，按父级聚类会把两批表头拆成两个簇（维度簇无下钻度量被弃、度量簇
   cells 数 ≠ 表头数校验失败）→ 网格映射整体为 null，悬停/点击全无反应。
   修复：**P 容器有祖先关系的簇合并**（外层吸收内层表头并重建 headerSet），
   误并仍由"数据行必须匹配拦截数据"兜底。实测 3 列场景
   （bus_type + receipt_count + agency.name）修复后端到端 ✅（悬停、Modal、
   1000 行明细、切片提示）。注意：跨表下钻查询（带多过滤 + 跨 cube join）
   首次响应可能 >5s，属正常 latency 非 bug
7. **table 兜底路径已删（2026-09-23 精简）**——初版按"结果区是 antd 表格"的
   假设写过 `<table>` 接线（matchHeaderText/resolveCell/realBodyRows/locateRow/
   onTableOver/Out/Click/bindTables table 循环，约 99 行），实测本镜像首页
   0 个 `<table>`、结果区永远是 div 网格，该路径从未触发且不可测试（不存在
   table 形态的结果区），已整条删除只留 div 网格路径。删后零退化重验
   （两列全链路 5 环节 ✅ 208=208 + 三列冻结列 Modal 1000 行 ✅）。注意
   Modal 自绘明细表是 `<table>`，但那是本脚本 renderTable 画的，交互走
   td.slicable 委托，与已删的页面 table 接线无关
8. **Modal 时间列切片拼非法查询（2026-09-23 实测修复）**——renderTable 曾把时间
   维度列也渲染成 td.slicable，点击切片拼 filters equals 完整时间戳（如
   2023-05-09T00:00:00.000）→ Oracle 拒绝（ORA-01830 实测复现）；stock_in/
   stock_out/stock_apply 三个主度量 drillMembers 含时间维度，触发面真实。
   修复：时间维度列不渲染 slicable（时间切片走 dateRange 留二期）。附带：
   gridCache 增加 P 存活校验（React 同响应重建结果区时自动重扫）；week 桶
   "周一起点"为未验证假设，归用例 2 人工验证
9. **"无度量列/未声明 drill_members"不再完全静默（2026-09-23）**——buildGridMaps
   在无任何可下钻网格时兜底绑最佳普通网格（drillable=false，仅撑点击提示，悬停
   仍无虚线框）；点击数据单元格提示定位：网格无可下钻度量列 → toast「当前查询
   未选择可下钻的度量」，点了度量格但该度量未声明 → toast「度量「X」未声明
   drill_members」。可下钻网格里点维度格仍静默 no-op。实测（仅 agency.name 无度量
   场景）：兜底绑定 ✅、悬停无虚线框 ✅、点击 toast ✅，schema 侧边栏簇仍被
   数据行校验排除
10. **2 度量场景 + display:contents 布局（2026-09-23）**——agency.name +
    receipt_count（有 drill_members）+ agen_cnt（无）三列触发 pinned 布局的新
    形态：装度量表头的 `UL.sc-dovzVR` 与**数据行 DIV 自身都是 `display: contents`**
    （getBoundingClientRect 全 [0,0,0,0]，孩子 cell 正常渲染、有宽高）——
    行校验与事件解析按**孩子 cell 可见性**（width>0）判断即可，不能按行容器自身
    尺寸。全链路实测 ✅：悬停高亮+title、点击 Modal（1000 行明细+上限提示）、
    点 agen_cnt 弹「未声明 drill_members」toast。排查中踩的三个测试坑（复测
    参考）：① 侧边栏 cube 节点未展开时成员按钮不在 DOM，点击静默无效（query
    只有维度 → 网格无度量列 → 本就无提示，非 ext-drill 问题）；② 度量值千分位
    （"20,766"）不匹配 `/^\d+$/` 探针，会误点到无 drill_members 的列；③ toast
    2600ms 自动消失，断言时机须 <2.6s
11. **4 列网格兄弟簇拆裂（2026-09-23 实测修复）**——2 维度 + 2 度量
    （agency.name + agency_code + receipt_count + agen_cnt）时 pinned 布局再变：
    **两个维度表头装进一个 `UL.sc-dovzVR`，两把度量表头装进另一个兄弟 UL**
    （都是 display:contents，rect 全 0），按父级聚类得两个簇、互不包含 →
    上一条祖先合并不触发 → 两簇都只有表头没有数据行，校验全失败 → 网格映射
    整体为 null（boundGrids: 0），悬停/点击全无。修复：**兄弟簇合并**——两簇
    公共祖先（各自 ≤2 层内，nearLca）作为候选行容器，合并 heads 后必须能匹配
    拦截数据（validateCluster）才采纳，数据行校验兜底防与侧边栏/查询构建区误并。
    实测 4 列场景修复后端到端 ✅（4 列全中 rowHit:true、悬停、Modal 1000 行、
    agen_cnt toast）。零退化重验：两列 test6 五环节 ✅、3 列冻结列
    （2 维度 + 1 度量，祖先合并路径）✅、2 度量 3 列 ✅、无度量列 toast ✅

**查询层已验证（curl/node 实测）**：用例 1 stock 下钻 209=209 ✅；用例 2 月份桶
`2026-09-01T00:00:00.000` → dateRange `['2026-09-01','2026-09-30']` ✅。

**浏览器已验证（Playwright + Edge headless 实测，用例 1）**：

| 环节 | 结果 |
|---|---|
| 悬停 | ✅ 虚线框 class + title「点击下钻：查看「票据库存 库存段数」明细」 |
| 单元格点击 → Modal | ✅ 标题/副标题/面包屑/明细表（208 行=单元格值）/底部切片提示 |
| 切片（点 Modal 内值） | ✅ 面包屑 +1，重查过滤生效 |
| 面包屑摘除 | ✅ 恢复原明细 |
| Esc / 遮罩关闭 | ✅ |
| 页面 JS 报错 | 无 |

下钻行数与单元格值一致（stock_count 为普通 count，208=208；countDistinct 度量
见上文第 3 条语义）。

**待人工确认（其余用例，打开 localhost:4000 点击）**：时间粒度桶下钻（用例 2）、
透视与 Chart 降级提示（用例 4-5）。调试钩子 `window.__extDrill.state()` 可查
`lastCapture`（捕获阶段）/`boundGrids`/`grid`（列映射与行容器）定位问题。
