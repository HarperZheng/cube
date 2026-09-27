# 15 dashboard 开发设计（embed 看板 demo：固化链 + 消费面，:4000 单服务）

> 状态：**已实施**——2026-09-24 设计逐项拍板（决策记录见 §4），§13.1 交付物全部落地；
> 2026-09-26 补录实码对照（§14）与功能快速查（§15）
> 参考：官方 [docs.cube.dev/embedding/iframe/dashboards](https://docs.cube.dev/embedding/iframe/dashboards)
> （iframe embedding 为 Cube Cloud Premium/Enterprise 功能，本地 OSS 无现成面层，需自建）；
> 官方五页文档存照：`tmp-cube-dash.md`、`tmp-embed-{cm,authp,auths,fv,ev}.md`（项目根目录）
> 前序：[08-drill端点与Playground下钻交互(todo).md](08-drill端点与Playground下钻交互(todo).md)
> （ext-* 零服务端模式与网格锚定方式）；[11-chat-agent开发计划-v2.md](11-chat-agent开发计划-v2.md)
> （桥/会话先例）；[13-前端到claude到cube消息传递路径.md](13-前端到claude到cube消息传递路径.md)
> 定位：**快速 demo——无登录、一 session 一用户、固化权给用户：
> playground 固化 → :4000 单服务（preload 补丁认领路由）→ embed 消费面**

---

## 1. 背景与动机

官方 iframe embedding（`/embed/dashboard/<publicId>`）是 Cube Cloud 付费面层：路由、登录页、
Embed→Settings 控制台、三层配置模型都由云服务承载，本地 OSS Cube（自建 `cube-oracle:local`
镜像）没有这些组件。用户要的核心链路是 **Creator Mode 式的"固化"**：

```
用户写一条查数 → 确认有效 → 固化为图表/看板 → 得 embed 链接 → 消费面查看
```

官方文档两个硬约束直接影响方案（五页存照原文）：

1. *"Private embedding does not support Creator Mode — use Signed embedding instead."*
   ——**用户固化（Creator Mode 能力）与 Private embedding（登录态）互斥**；demo 无登录约束下
   走 Signed 的**简化形态**（无 session 签发，无鉴权直查，§7），而非 Private。
2. *"a workbook must have a published dashboard for users to open it"*
   ——固化（Publish）是消费的闸门；demo 简化为**固化即发布**（见 §4 决策 4）。

## 2. 阶段边界（三约束拍板）

| 项 | demo | 说明 |
|---|---|---|
| 用户/登录 | **无** | 不做账号、不做登录页（Private embedding 不在 demo 范围）；embed 路由不校验身份 |
| session | **一 session 一用户** | demo 无 session 概念（无签发、无鉴权，§7）；换真时补两步流承载 settings/身份 |
| 固化权 | **给用户** | 创作面进 demo；`canPublish` 作为 settings key 预留（demo 阶段固化端点不校验） |

## 3. 官方功能 → demo 裁剪

| 官方功能 | demo 处置 | 换真时的改动点 |
|---|---|---|
| Private embedding / 登录页 | ❌ 不做 | embed-patch 认领路由处加会话校验 |
| generate-session | ⏸ 后置（端点形状在 §6 预留注释，demo 无鉴权直查） | 换真补回（§12.2） |
| token 交换 / 5min 过期 / 续期 / revoke | ❌ 不做（§7 两步流整体后置） | `/session`+`/token` 补回 |
| Creator Mode 创作面 | ✅ 简化版：playground + ext-publish.js | — |
| dashboard 存储 | ✅ JSON 文件 | 存储分租户目录 |
| `/embed/dashboard/<publicId>` 消费面 | ✅ 核心新页面 | — |
| URL 参数 `allowExport` / `showDashboardHeader` | ✅ 最小集，解析规则照搬官方 | 补 `f_`/`tg_`/`ms_`/`tab_` + 双向写回 |
| 三层配置模型 | 降为一层：URL 参数（session settings 层随两步流后置） | 补账号层 + session 层 |
| 查询链路 | ✅ 同源直查（dev 模式无 Authorization，§7） | 两步流补回 + JWT 注入 securityContext |
| Comments / 多租户 / userAttributes | ❌ 不做 | — |
| tabs / 拖拽布局 / AI summary widget | ❌ 后置 | 数据模型加字段（§12） |
| locale / Styling / Events | ❌ 不做 | — |

## 4. 关键决策记录（2026-09-24 用户拍板）

| # | 决策点 | 结论 | 落点 |
|---|---|---|---|
| 1 | 创作面路径 | **playground + ext-publish.js**（查询构建器现成，延续 ext-* 模式） | §9 |
| 2 | 服务形态 | **:4000 单服务**——不加独立端口；沿用 preload 补丁机制认领路由 | §5/§6 |
| 3 | 鉴权 | **demo 无鉴权直查**（dev 模式同款，与 playground 行为一致）；两步流后置为换真路径（§12.2） | §7 |
| 4 | 固化语义 | **固化即发布**（无草稿态），publicId 11 位 base62 | §8 |
| 5 | 布局 | **档位流式**（整行/半行 + 垂直堆叠，纯 CSS）；**未来可能改网格布局**（§12.1） | §8/§12 |
| 6 | 图表渲染 | **vendor ECharts**（curl 下载一次存项目；内网 CDN 运行时不可靠） | §10 |
| 7 | 下钻 | **v1 就带**（消费面是自己的 HTML，annotation+drillMembers 直接拿，比 playground 猜 DOM 容易） | §10.3 |
| 8 | tab 位置与面板形态 | **Dashboard tab 坐在 Playground 与 Data Model 之间**；面板 = **聚合看板网格**（所有看板 widget 一起铺开，无下拉切换），直接渲染不跳新界面（参考官方 Orders Overview 截图 `tmp-ref-dash.png`：KPI 数字卡 + 图表两列网格） | §9 |

## 5. 总体架构（:4000 单服务）

```
┌─ 创作面（Playground :4000 + ext-publish.js —— 页面内 JS）────────────┐
│  查询构建器（现成）→ Dashboard 导航 tab（Playground 与 Data Model 之间）│
│  → 聚合看板网格（iframe /embed/all，一行两个看板）                     │
│  固化入口：聊天答案卡「在构建器中打开」右边「固化到看板」按钮           │
│  → 对话框：标题/图表/宽度(默认整行=整看板行)/目标(新建|追加)           │
│  → 同源 POST /cubejs-api/dashboards（无跨域）→ 固化即发布             │
│  → toast 回显 publicId + embed 链接                                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼ 同源 HTTP
┌─ embed-patch.js（preload.js require，拦 http.createServer）───────────┐
│  认领两个命名空间（Cube 路由之前，其余请求全部放行）：                  │
│  /cubejs-api/dashboards*   固化写入/读取/列表                          │
│  /embed/*                  GET /embed/dashboard/<publicId> → HTML     │
│  存储：/cube/conf/dashboards/<publicId>.json（conf 已挂载，零新挂载）  │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼ 同源直查（dev 模式无 Authorization，与 playground 同款）
                 Cube API /cubejs-api/v1/load ──▶ Oracle
┌─ 消费面（embed-dashboard.html + vendor ECharts）─────────────────────┐
│  header（标题+CSV）→ 档位流式 widget 卡片 → ECharts/表格渲染          │
│  表格卡 drillMembers 下钻；URL 参数 allowExport/showDashboardHeader   │
└──────────────────────────────────────────────────────────────────────┘
```

:4000 单服务的选型理由（§4 决策 2）：

1. 固化需要"写"的端点，浏览器写不了磁盘；ext-* 模式只能注入页面内 JS，加不了 HTTP 端点
   ——preload 补丁机制**已经存在**（Oracle thick 模式、11g 分页改写），同机制再拦一层
   `http.createServer` 即可，业务代码拆独立文件不与驱动补丁混
2. 同源消除 CORS（固化 POST 不跨端口）
3. 查询链路最短：同源 + dev 模式接受无鉴权查询（ext-drill 实测先例，`lastAuth` 为空仍可用）
   ——消费页直查 `/v1/load`，secret 不进任何页面
4. 代价：与 Cube 内部 http server 有一个耦合点，**升级 Cube 镜像时补丁需重新验证**；
   拦截必须放行非认领路径（playground、websocket 刷新）

## 6. embed-patch.js：命名空间契约

```
# 固化 / 看板 CRUD
POST /cubejs-api/dashboards                { title, widget:{title,viz,layout,query} } → { publicId }   新建
GET  /cubejs-api/dashboards                → [{ publicId, title, updatedAt }]                          列表（追加下拉）
GET  /cubejs-api/dashboards/:publicId      → 定义全文
PUT  /cubejs-api/dashboards/:publicId      { widget } → { publicId }                                   追加 widget

# session / token（两步流）——demo 后置（§7），换真时补回，形状预留：
# POST /cubejs-api/dashboards/session        { settings:{canPublish,...} } → { sessionId }
# POST /cubejs-api/dashboards/token          { sessionId } → { token }

# 消费面页面
GET  /embed/dashboard/:publicId            → embed-dashboard.html（publicId 由页面从 location.pathname 解析）
GET  /embed/all                            → 同页面，聚合模式（所有看板 widget 一个网格）
GET  /embed/static/echarts.min.js          → vendor 静态资源
```

- 命名空间零冲突：Cube 自身只有 `/`（playground）与 `/cubejs-api/v1/*`，
  `/cubejs-api/dashboards*` 与 `/embed/*` 均未被占用
- 文件布局（**零新挂载**，全部落进已挂载的 conf/；compose 仅 ext-publish.js 加一行单文件挂载，
  同 ext-chat/ext-drill 既有模式）：

```
D:\develop\cube\
  preload.js                    # 现有，加一行：require('/cube/conf/embed/embed-patch.js')
  conf/
    embed/
      embed-patch.js            # 新：路由认领 + 看板存储 API（JWT 签发后置，§7）
      embed-dashboard.html      # 新：消费面页面（patch sendFile）
      assets/echarts.min.js     # vendor（curl 下载一次，内网离线可用）
    dashboards/                 # 新：看板存储 <publicId>.json
  playground-ext/
    ext-publish.js              # 新：固化扩展（compose 加挂载一行）
```

## 7. 鉴权：demo 无鉴权直查（两步流后置）

**demo 阶段不需要签名、鉴权**——消费页与 playground 同源同 dev 模式，直接裸查：

```
消费页 → POST /cubejs-api/v1/load（无 Authorization，dev 模式接受）
```

三条依据：

1. **dev 模式 API 接受无 Authorization 查询**——ext-drill 实测先例：页面请求 `lastAuth`
   为空，下钻请求不带 Authorization 照样跑通（08 文档）；embed 页面同源同模式，行为一致
2. **secret 隔离天然成立**：页面根本不需要 secret，`CUBEJS_API_SECRET` 不进任何浏览器
3. **签名没有保护对象**：demo 无登录约束下一切敞开，防篡改（viewer 改 settings）无意义

JWT 两步流（session 签发 → token 换发）不在 demo 范围：端点形状已在 §6 注释预留，
换真时补回（§12.2）。

换真补回路径（对齐官方 signed embedding 两步形态）：

| 环节 | 官方 | 换真改动 |
|---|---|---|
| 签发 | 服务端 session，5min 有效 | `/session`：settings 进 payload，`CUBEJS_API_SECRET` 签名 |
| 换发 | iframe 自动换 23h token | `/token`：验 session → 签查询 JWT（settings 不进查询凭证，避免混入 securityContext） |
| 行级权限 | userAttributes 随 session 自动过滤 | 查询 JWT 注入 securityContext（rgn_code 等，access_policy 生效） |
| 生命周期 | 5min/单次/可续期/可 revoke | TTL + refresh + 登出钩子 revoke |

- settings 载体（`{ canPublish: true }`）随两步流后置；demo 固化端点不校验（§2 边界）
- 行级权限兼容：查询无 securityContext 时，daybook/backpay 等 access_policy 走
  `allow_all` 分支（与现有无登录 dev 查询行为一致）

## 8. dashboard 数据模型

```jsonc
// conf/dashboards/<publicId>.json —— publicId = 11 位 base62（对齐官方 OwVQpbdaZmBT 形状）
{
  "publicId": "OwVQpbdaZmBT",
  "title": "月度收入看板",
  "createdAt": "2026-09-24T10:00:00.000Z",
  "updatedAt": "2026-09-24T10:00:00.000Z",
  "widgets": [
    {
      "id": "w1",
      "title": "收款金额按月趋势",
      "viz": "bar",                        // table | bar | line | pie | number
      "layout": { "width": "full" },       // v1：full | half —— 开放对象，见下
      "query": {                           // 固化时的 Cube query 原样存档
        "measures": ["daybook_view.income_amt"],
        "dimensions": ["daybook_view.income_sort_name"],
        "timeDimensions": [{ "dimension": "daybook_view.received_date", "granularity": "month" }],
        "filters": []
      }
    }
  ]
}
```

模型规则：

1. **query 是成员名引用，不是数据快照**：存储里没有一行业务数据，`daybook_view.income_amt`
   存的是语义层成员的**引用**——渲染时实时查数，看板永远看最新数据；cube-modeling 改成员
   口径（如 filters 变更）→ 看板自动跟随最新口径，无需重新固化。唯一断链场景：成员
   **改名/删除** → 引用落空，兜底两层：view 交付面**只增不删**（改名前成员不消失）+
   消费页 **per-widget 错误隔离**（一个 widget 报错只渲染错误卡片，不拖垮整板）
2. **query 原样存档**：measures/dimensions/timeDimensions/filters 固化时快照；annotation 不存
   （title/shortTitle 消费页从 `/v1/load` 响应现拿，避免双份维护）；捕获自网关**响应**回显，
   `rowLimit` 回显字段需剥离——请求侧网关拒绝（ext-drill 同款实测："rowLimit is not allowed"），
   固化时删一次 + 消费面发查询前防御性再删一次（救活存量定义）
3. **widget 查询盖 limit 上限**：固化时统一封顶（数值 10 / 图表 100 / 表格 1000），防高基数拖垮渲染；
   官方同理（*"a widget's CSV is generated client-side from the data already loaded"*，
   数据量即渲染量）
4. **`layout` 是开放对象**（为 §12.1 网格布局预留）：消费面渲染器按**字段存在性**分支——
   有 `x/y/w/h` 走网格坐标渲染，否则回退 `width` 档位；新增字段不破坏存量定义
5. **固化即发布**：无草稿态、无 published 字段，写入即可用（§4 决策 4）

字段规则：

| 字段 | 类型 | 规则 |
|---|---|---|
| `publicId` | string | **主键**；11 位 base62（对齐官方 `OwVQpbdaZmBT` 形状）；生成时查重，撞了重生成 |
| `title` | string | **不强制唯一**（追加下拉以 title 显示，重名时附加 publicId 尾缀区分） |
| `createdAt` / `updatedAt` | ISO 8601 | 追加 widget / 修改时刷新 |
| `widgets` | array | **数组顺序 = 固化顺序**（档位流式堆叠依据；未来网格布局保留此顺序，作为 y 坐标默认值来源） |
| widget.`id` | string | dashboard 内唯一，`w1/w2…` 递增 |
| widget.`viz` | enum | `table \| bar \| line \| pie \| number`（number = KPI 数值卡） |

存储方案（每看板一 JSON 文件，写入语义在 embed-patch.js 内实现）：

- **conf/ 哲学对齐**：conf/ 已承载两类"存照"——cube/view yml（语义层定义）、regress 基线
  （口径存照）；看板定义是第三类：**"已固化查询的存照"**，同一哲学的第三个实例。
  落 conf/ = 已挂载零新配置、与模型文件同仓管理、应急可直接改文件
- **写入原子性**：temp + rename 原子替换——追加中断不留半截文件（单用户 demo 无并发写，
  这一条就够）

```
POST（新建）: base62 生成 publicId → exists 查重（撞了重生成）→ 写 <temp> → rename 原子替换
PUT （追加）: 读全文 → widgets.push + id 递增 + updatedAt 刷新 → 同样 temp+rename 写回
GET （列表）: readdir → 逐文件解析（demo 规模 <100 看板足够；不建 index 文件，规模大再加）
GET （单个）: 直读文件；消费页每次渲染现读，无缓存层
```

## 9. 固化交互（ext-publish.js，创作面）

**Dashboard 导航 tab**（v2，2026-09-24 用户拍板：tab 坐在 Playground 与 Data Model 之间）：
ext-publish.js 向 playground 顶部菜单（antd Menu + react-router `/build`、`/schema`）注入
`<li class="ant-menu-item"><a>Dashboards</a></li>`，插在 Playground 项之后；MutationObserver
防抖重插（React 重渲染删掉时自愈）。点 tab 开面板（铺 header 以下内容区，导航保持可点，
点其他导航自动关面板）：

```
┌─ Dashboards ───────────────────[固化当前查询]─┐
│ ┌───────────────────────────────────────────┐ │
│ │ 我的看板               ← 看板名作小节标题   │ │
│ │ 125,226    80,044      ← KPI 数值卡        │ │
│ │ ▂▄▆█ 柱状  │  ▂▄▆█ 折线   ← 两列网格       │ │
│ │ 表格       │  ◐ 饼图                       │ │
│ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

「固化到看板」按钮点开自绘对话框（样式对齐 antd，同 ext-drill Modal 先例）。**固化入口
（2026-09-24 用户拍板 v5）**：聊天答案卡「在构建器中打开」右边的按钮——ext-publish 注入
DOM（不动 ext-chat 代码），query 从消息 `data-ext-query` 载体取（ext-chat 只读加一行），
**每条回答固化自己的查询**；Dashboard tab 面板不再放固化入口：

```
┌─ 固化到看板 ──────────────────────────┐
│ 标题: [总金额、票据数 按 代理机构名称、 │   ← 默认 = annotation 中文 title 拼接
│       收款日期（按月）              ]  │     （粒度拼进时间维度；缺失回退成员短名）
│ 图表: (•)表格 ( )柱状 ( )折线 ( )饼图   │
│       ( )数值                          │   ← number = KPI 数值卡
│ 宽度: (•)整行  ( )半行                  │   ← layout.width 档位；整行=整看板行
│                                        │     （看板卡已占半页，卡内组件满行，2026-09-24 拍板）
│ 目标: (•)新建看板 [月度收入看板       ] │
│       ( )追加到 [GET /dashboards  ▼]   │   ← 列表接口填下拉
│                        [取消] [固化]    │
└─────────────────────────────────────────┘
```

- 数据来源（v5）：聊天消息 `data-ext-query` 载体（ext-chat `renderAnswer` 只读加一行
  `div.setAttribute('data-ext-query', ...)`），固化该条回答的 query 原样——ext-chat 走
  自己的 CHAT_URL 不经 /v1/load，**ext-drill 捕获不到聊天查询，载体是唯一通路**；
  默认标题的 annotation 仍从 ext-drill `state()` 取（title 按成员名查、与捕获查询
  成员重叠即命中），缺失回退成员短名
- **默认标题可读化（2026-09-24 用户拍板方案 A）**：ext-drill `state()` 加暴露 `annotation`
  只读口（一行纯加性，既有 key/行为不动），固化默认标题 = annotation 中文 title 拼接
  （`总金额、票据数 按 代理机构名称、收款日期（按月）`，粒度拼进时间维度）；
  annotation 缺失回退成员短名。备选方案 B（自拉 /v1/meta 建名→题映射）因 meta 响应大、
  与 annotation 重复第二条链路被否；用户问题溯源（多轮对话难溯源、手写查询无问题文本）后置
- **默认标题自然语言化（2026-09-26 拍板方案 B，§16）**：拼接仍是列名堆砌，业务意图
  （核销情况）与 filter 语义（已核销）只在对话里——answer 契约加 `title` 字段
  （LLM 一句话标题），ext-chat `data-ext-title` 载体，ext-publish 优先取、
  缺失回退上面的 annotation 拼接
- tab 面板行为（v4 聚合网格、无下拉 + v5 一行两个看板，2026-09-24 用户拍板）：
  iframe 同源 `/embed/all?allowExport=true&showDashboardHeader=false`——所有看板进
  **2 列网格（一行两个看板卡）**，看板名作卡内小节标题，widget 网格在卡内
  （full=卡宽 / half=半卡）；表格/图表/下钻/CSV **零重复实现**全复用消费面；
  固化后自动刷新带进新 widget；面板顶栏只有标题（v5 起固化入口移到聊天答案卡）
- **AI 对话框浮窗（2026-09-24 用户拍板）**：Dashboard 面板开着时聊天走 fixed 浮窗
  （同 /schema 兜底形态）——ext-chat `attach()` 加 `dashSurfaceOpen()` 条件
  （查 `.ext-pub-surface` 存在）：flex 列会被面板盖住（面板 z-index 900 < 浮窗 9998），
  开着→从 flex 列摘下转浮窗，关闭→升级回 flex 列；z-index 已就位无需改
  （浮窗 9998 / 面板 900 / 固化对话框 9999）
- session：demo 无（§7 无鉴权直查）；换真时固化流程不变，仅固化端点加会话校验
- 成功 → toast 回显 publicId + 完整 embed 链接，一键复制
- 固化权 `canPublish`：demo 端点不校验（§2 边界）；key 随两步流后置（§7 settings 载体）

## 10. 消费面渲染（embed-dashboard.html）

```
┌──────────────────────────────────────────┐
│ 月度收入看板                    [下载CSV] │ ← header（showDashboardHeader=false 可藏）
├──────────────────────────────────────────┤
│ ┌─ 收款金额按月趋势（整行）─────────────┐ │
│ │        ▂ ▄ ▆ █ ▆  ECharts 柱状        │ │
│ └───────────────────────────────────────┘ │
│ ┌─ 退款方式分布（半行）─┐┌─ 区划 Top ───┐ │
│ │       ◐ 饼图          ││  表格         │ │
│ └───────────────────────┘└───────────────┘ │
└──────────────────────────────────────────┘
   src="/embed/dashboard/<publicId>?allowExport=true"
```

### 10.1 渲染流程

`GET /embed/dashboard/<publicId>`（HTML）→ 页面解析 publicId + URL 参数 →
逐 widget 直查 `POST /cubejs-api/v1/load`（dev 模式无 Authorization，§7）→
按 `viz` 分支渲染（ECharts bar/line/pie；table 原生表格；number KPI 数值卡，
measures 直出大数字）→ annotation 提供 title/shortTitle。

聚合模式 `GET /embed/all`：读看板列表 → 逐看板取定义 → 看板卡进 **2 列网格
（一行两个看板，2026-09-24 用户拍板）** → 看板名作卡内小节标题 → widget 网格在卡内
（列表按 updatedAt 倒序，逐看板串行渲染）。

**per-widget 错误隔离**（§8 规则 1）：单个 widget 查询失败（如成员改名导致引用落空）只渲染
该卡片的错误态，不拖垮整板——存量的 query 是成员名引用，断链兜底靠 view 只增不删 +
此处的错误隔离。

### 10.2 布局：档位流式（v1）

- `width: full` 整行 / `half` 半行（12 列语义：full=12、half=6），按固化顺序垂直堆叠
- 纯 CSS（flex/grid 流式），无拖拽、无重叠、无坐标——实现约 30 行样式
- **前向兼容网格布局**：`layout` 开放对象 + 渲染分支（§8 规则 3、§12.1）

### 10.3 表格下钻（drillMembers，v1 就带）

- annotation 中每个 measure 自带 `drillMembers`（2026-09-24 已为 daybook/backpay 补齐，
  view 透传已验证）——消费页直接读，**不需要猜 DOM**（比 ext-drill 在 playground 里
  的网格锚定容易一个量级）
- 交互复刻 ext-drill §3 的查询拼装：drillMembers → dimensions、行内维度值 → equals filters、
  时间粒度 → 该桶 dateRange（`bucketToRange` 逻辑从 ext-drill 移植）、继承 filters/timezone
- 展示：点指标单元格 → 下方展开明细表（自绘，行内值可点 → 加 filter 切片）；
  限制同 ext-drill：ungrouped / 非标准时间粒度 → 提示而非静默失败

### 10.4 CSV 导出

- `allowExport=true`（**仅字面 `true`**，`=1`/`=TRUE`/裸参数无效——照搬官方解析）时
  header 显示「下载 CSV」：客户端从已加载数据生成，**不发新查询**
- widget 级导出 = 该 widget 数据；整板导出 v1 不做（官方 dashboard 级 PNG/PDF 后置）

## 11. URL 参数（v1 最小集）

| 参数 | 效果 | 解析规则（照搬官方） |
|---|---|---|
| `allowExport=true` | 显示 CSV 导出 | 授权类，**仅字面 `true`** |
| `showDashboardHeader=false` | 隐藏整条 header | 隐藏类，**仅字面 `false`**（`=0`/`=False`/裸参数无效） |

- 参数从 iframe src 读入后 pinned，页面内不回写（官方的双向写回属 `f_`/`tg_` 体系，后置）
- 两条布尔约定互为镜像，与官方一致：授权类需"开"，隐藏类需"关"

## 12. 未来演进

### 12.1 网格布局升级（**用户点名预留**）

档位流式（v1）→ 网格坐标（未来）的升级路径，数据模型**现在就留好口子**：

- **字段预留**：`layout` 是开放对象（§8 规则 3），未来直接加 `x/y/w/h` 字段，
  存量定义零破坏——`width: full/half` 与 12 列网格**机械可映射**（full=w:12、half=w:6、
  y=固化顺序累计），必要时跑一次脚本迁移即可，也可不迁（渲染分支兼容两种）
- **渲染分支**：消费面渲染器按字段存在性分流——widget 有 `x/y/w/h` 走绝对定位网格渲染，
  无则回退档位流式。新旧 widget 可在同一看板共存（渐进迁移，不强制一次切）
- **升级触发条件**：需要 widget 重叠、自由缩放、拖拽排序编辑器时再上；届时固化对话框
  的"宽度档位"换成"拖拽画布"，消费面只换渲染分支，查询/固化/存储链路全部不动
- 官方对齐：Cube Creator Mode 的 dashboard 编辑器即网格拖拽形态，换真时直接对齐

### 12.2 换真路径（demo → 生产）

| 能力 | 改动点 |
|---|---|
| 登录/账号（Private embedding） | embed-patch 认领路由处加会话校验 + 登录页 |
| 鉴权 + JWT 两步流补回 | `/session`+`/token` 端点（§6 预留形状）：session 签发 → 查询 JWT 换发，secret 服务端签发、不进页面 |
| token 生命周期（过期/续期/revoke） | `/token` 端点：TTL 缩短 + refresh + 登出钩子 revoke |
| 行级权限进 embed | `/token` 签发查询 JWT 时注入 securityContext（rgn_code 等） |
| `f_`/`tg_` 预置 + 双向写回 | 消费面 JS：URL 参数解析扩展 + `history.replaceState` |
| 多租户隔离 | 存储 API 按 `embedTenantName` 分目录；session settings 加租户键 |
| 三层配置补全 | 账号层（Embed→Settings 等价物）：settings 默认值文件 → 控制台 |
| tabs / AI summary widget | 数据模型加字段（widgets[].tabs / 新 widget 类型） |

## 13. 实施清单与验证

### 13.1 实施清单

| # | 交付物 | 说明 |
|---|---|---|
| 1 | `conf/embed/assets/echarts.min.js` | curl 下载 vendor 一次（内网离线可用） |
| 2 | `conf/embed/embed-patch.js` | 路由认领（两个命名空间）+ 看板存储 API（JWT 后置） |
| 3 | `conf/embed/embed-dashboard.html` | 消费面：直查 load→渲染、档位流式、下钻、CSV |
| 4 | `conf/dashboards/` | 看板存储目录 |
| 5 | `playground-ext/ext-publish.js` | 固化扩展 + compose 挂载一行 |
| 6 | `preload.js` | 加一行 require embed-patch |
| 7 | `docker-compose.yml` | 仅 playground-ext/ext-publish.js 单文件挂载（同 ext-chat/ext-drill 模式） |

### 13.2 验证清单（对照三关）

| 关 | 验证 |
|---|---|
| 关1 编译不受扰 | `check` 全绿；playground 正常加载（拦截放行验证：页面、websocket、`/cubejs-api/v1/*` 不受扰） |
| 关2 端到端固化链 | playground 构建查询 → 固化 → conf/dashboards 落盘 → 打开 embed 链接 → 渲染出表格+图表 |
| 关3 交互逐项 | 下钻（点指标单元格出明细）、CSV（客户端生成不发查询）、URL 参数（字面 true/false 正反例）、追加固化 |

### 13.3 风险与注意

1. **preload 拦截放行**：createServer 包装必须透传非认领路径——playground 页面、
   HMR/websocket、`/cubejs-api/v1/*`、`/logs`；认领路径与 Cube 自身路由零重叠（§6）
2. **镜像升级**：embed-patch 与 Cube 内部 http server 有耦合点，升级 `cube-oracle:local`
   镜像时补丁需回归（关1+关2 重跑）
3. **ECharts vendor**：一次下载入库，禁止运行时引 CDN（内网不可靠）；版本固定不升级
4. **query limit 封顶**：图表 100 / 表格 1000（§8 规则 2），固化对话框不暴露该值，
   超限提示与 ext-drill `ROW_LIMIT` 同款文案
5. **月粒度别名超长（既有约束，非本设计引入）**：Cube 生成的列别名是
   `cube名__成员名_粒度`，`daybook_view__received_date_month`（33 字符）超 Oracle 11g
   30 字符限制报 ORA-00972——playground 同样会报；消费面 per-widget 错误隔离正好兜住
   （错误卡片，不拖垮整板）。根治属建模层（成员改名/预聚合），不在本设计范围

## 14. 数据链路实码对照（存储 / 刷新 / load 绑定，2026-09-26 补录）

设计（§1–§13）落地后的实码对照，回答三个问题：**参数存在哪里、哪处代码刷新、
如何刷新**。核心事实：固化存的是**查询定义不是数据快照**，消费面每次渲染
实时 POST `/cubejs-api/v1/load`。

### 14.1 参数存在哪里

**宿主机 `conf/dashboards/<publicId>.json`**（容器内 `/cube/conf/dashboards/`，
docker-compose 挂载 `./conf:/cube/conf`），写入方 `embed-patch.js` 的 `handleApi()`
（POST 新建 / PUT 追加，`atomicWrite()` temp+rename 原子落盘，§8 存储方案）。

实码实例 `conf/dashboards/0tbFQboLFSX.json`（2026-09-26 固化，viz=bar）：

- `query.measures = ["writeoff_view.inv_num"]`、`dimensions = ["writeoff_view.name"]`、
  `filters = [{ member: "writeoff_view.state", operator: "equals", values: ["2"] }]`
  ——固化时**原样存档**（§8 规则 1），filters 固化后每次查询永久生效
- `limit: 100`——固化时按 viz 封顶改写（源查询 limit 500，柱状图封顶 100，§8 规则 3）
- **文件里没有任何一行业务数据**——`data` 从不落盘，这是"非快照"的根源

### 14.2 哪处代码刷新、如何刷新

刷新代码全在消费面 `embed-dashboard.html`，链路「页面加载 → 取定义 → 逐 widget 实时查」：

| 步 | 代码落点 | 行为 |
|---|---|---|
| 1 触发 | embed 页（重）加载；playground 面板设 iframe src（`ext-publish.js` `renderAllPanel()`）；固化成功后重载（`doPublish()` 成功分支调 `renderAllPanel()`） | 唯一的刷新扳机 |
| 2 取定义 | `embed-dashboard.html` `render()` / `renderAll()` | `GET /cubejs-api/dashboards[/:publicId]` 读回 JSON 定义（现读无缓存，§8） |
| 3 拷 query | `renderWidget()` | 深拷 `w.query`，删 `rowLimit`（请求侧网关拒绝；存量定义防御性再删，§8 规则 2） |
| 4 取数 | `renderWidget()` 内 `fetch(LOAD_URL, …)`（`LOAD_URL = '/cubejs-api/v1/load'`） | **POST `{ query }`**，同源无 Authorization（§7）——参数就是 JSON 文件里那份 |
| 5 渲染 | `renderTable` / `renderChart` / `renderNumber` | 响应 `annotation` + `data` 按 viz 分支渲染；annotation 现拿不存（§8 规则 2） |

下钻另有一处取数：`runDrill()` 同样 POST `/v1/load`（明细查询，拼装规则 §10.3）。

### 14.3 刷新时机（当前全量）

| 时机 | 行为 |
|---|---|
| 打开 / 刷新 embed 页、重开 Dashboard 面板 | 所有 widget 重新 POST `/v1/load`，拿到**当时最新数据** |
| 固化新 widget 成功 | 面板 iframe 重新加载，带进新 widget |
| 表格下钻 / 切片摘除 | 发新的 `/v1/load` 明细查询 |

**没有的**：`setInterval` 轮询、Cube `subscribe` 流式订阅、手动刷新按钮——页面开着不动，
数据停在最初那批。要自动刷新需在消费面周期性重跑各 widget 的取数（或接 `subscribe`），
当前未实现未排期（§15.4 边界清单）。

## 15. 功能快速查（全功能自查表，2026-09-26）

按三面分组；「落点」是实码文件/函数名，grep 即达。边界清单在 §15.4——
自查"没有什么"与自查"有什么"同样重要。

### 15.1 创作面 `playground-ext/ext-publish.js`

| 功能 | 触发/入口 | 落点 | 说明 |
|---|---|---|---|
| Dashboard 导航 tab | playground 顶部菜单，Playground 与 Data Model 之间 | `injectTab()` + MutationObserver 防抖重插 | React 重渲染删 li 自愈（200ms） |
| 聚合看板面板 | 点 tab 开/再点关 | `openPanel()` / `closePanel()` | fixed 面板铺 header 以下；iframe `/embed/all?allowExport=true&showDashboardHeader=false`；点其他导航自动关并恢复原选中态 |
| 固化入口按钮 | 聊天答案卡「在构建器中打开」右边 | `injectPubBtn()`（注入 `.ext-chat-acts`，不动 ext-chat 代码） | query 取消息 `data-ext-query` 载体；无 measures 的回答提示不可固化 |
| 固化对话框 | 点「固化到看板」 | `openDialog()` | 标题 / 图表（表格·柱状·折线·饼图·数值）/ 宽度（整行·半行）/ 目标（新建·追加） |
| 默认标题 | 对话框打开时 | `openDialog()` 优先 `data-ext-title` 载体（LLM 一句话标题，§16），缺失回退 `defaultTitle()` | 载体由 ext-chat `renderAnswer()` 写入；回退级 = annotation 中文 title 拼接，再回退成员短名 |
| 追加目标下拉 | 对话框打开时 | `openDialog()` 内 `fetch(API)` | `GET /cubejs-api/dashboards` 填 select；重名附 publicId 尾缀区分 |
| 固化写请求 | 点「固化」 | `doPublish()` | 新建 `POST /cubejs-api/dashboards` / 追加 `PUT /:publicId`；query 深拷原样 + 删 `rowLimit` + limit 封顶（表格 1000 / 图表 100 / 数值 10） |
| 成功回显 | 固化完成 | `doPublish()` 成功分支 | toast 回显 publicId，点击复制 embed 链接；面板开着则 `renderAllPanel()` 刷新 |
| 聊天浮窗联动 | 面板开/关 | `ext-chat.js` `dashSurfaceOpen()`（查 `.ext-pub-surface`） | 面板开着聊天转 fixed 浮窗，关闭升级回 flex 列；z-index 浮窗 9998 / 面板 900 / 对话框 9999 |

### 15.2 服务端 `conf/embed/embed-patch.js`（preload.js require，先于 Cube 执行）

| 功能 | 落点 | 说明 |
|---|---|---|
| 路由认领机制 | `claim()` + 拦 `http.createServer`（两种参数形态都包） | 只认领 `/cubejs-api/dashboards*` 与 `/embed/*`，其余全放行（playground / websocket / `/cubejs-api/v1/*` 不动） |
| 新建看板 | `handleApi()` POST 分支 | `checkWidget()` 结构自检（title / viz 白名单 / query.measures）→ publicId 11 位 base62 查重 → `atomicWrite()` |
| 看板列表 | GET 分支 | readdir 逐文件解析，`updatedAt` 倒序；demo 规模不建 index |
| 读单个看板 | GET `/:publicId` 分支 | 直读文件；不存在 404；`isPublicId()` 顺带挡路径穿越 |
| 追加 widget | PUT `/:publicId` 分支 | `widgets.push` + id `w{n+1}` 递增 + `updatedAt` 刷新 + 原子写回 |
| 其余方法 | 405 兜底 | 命名空间内全应答不挂死 |
| 消费面页面 | `handleEmbed()` | `/embed/dashboard/:id` 与 `/embed/all` 都回 `embed-dashboard.html`（模式由页面自己按 pathname 分） |
| ECharts vendor | `handleEmbed()` | `/embed/static/echarts.min.js` 本地静态（禁运行时 CDN，§13.3-3） |
| 鉴权 | 无 | demo 无鉴权直查（§7），`CUBEJS_API_SECRET` 不进任何页面 |

### 15.3 消费面 `conf/embed/embed-dashboard.html`

| 功能 | 触发 | 落点 | 说明 |
|---|---|---|---|
| 单板 / 聚合渲染 | 页面加载 | `render()` / `renderAll()` | 单板按 publicId；`/embed/all` 看板卡 2 列网格（≤1100px 单列），列表倒序逐板串行渲染 |
| 实时取数（核心） | 每 widget | `renderWidget()` → POST `/cubejs-api/v1/load` | 详见 §14.2；同源无 Authorization |
| 五种 viz | 渲染分支 | `renderTable` / `renderChart` / `renderNumber` | 表格 sticky 表头 + 420px 滚动；bar/line/pie 走 ECharts（时间维度优先做 x 轴，无维度时度量名做类目）；number 出 KPI 数值卡（空值 `—`） |
| 布局档位 | 渲染 | `applyLayout()` | `layout.x/w` 网格坐标优先，回退 `width` full=12 / half=6（≤900px half 也占满，§8 规则 4 / §10.2） |
| per-widget 错误隔离 | 查询失败 | `renderWidget()` catch | 单卡错误态（HTTP + 响应体前 200 字），不拖垮整板（§10.1） |
| 表格下钻 | 点指标单元格 | `drill()` / `buildDrill()` / `runDrill()` | drillMembers → dimensions、行内维度值 → equals filters、时间粒度 → 该桶 dateRange、filters/timezone 继承（§10.3） |
| 明细切片 | 点明细行内值 | `runDrill()` slices | chip 累积、✕ 摘除、重发明细查询 |
| CSV 导出 | `allowExport=true`（仅字面） | `exportCsv()` | 客户端从 `card.__loaded` 已加载数据生成，BOM 兼容 Excel 中文，**不发新查询**（§10.4） |
| URL 参数 | 页面加载 | `param()` | `allowExport` / `showDashboardHeader` 字面 true/false，其余参数一律忽略（§11） |
| 图表自适应 | window resize | `charts.forEach(resize)` | echarts 实例注册进数组同步 |

### 15.4 已知边界（demo 未做，自查"没有什么"）

| 缺口 | 说明 / 演进落点 |
|---|---|
| 数据自动刷新 | 无定时器、无 `subscribe` 流式订阅、无手动刷新按钮——重载页面才是新数据（§14.3）；要加需在消费面周期重跑取数 |
| 看板 / widget 删除与编辑 | 存储 API 只有新建 + 追加（§6）；应急直接改 `conf/dashboards/*.json`（§8 存储哲学） |
| 拖拽网格布局 / tabs / AI summary widget | §12.1 已留 `layout` 开放对象口子，§12.2 数据模型加字段 |
| 整板 PNG/PDF 导出、`f_`/`tg_`/`ms_`/`tab_` 参数与双向写回 | §3 / §12.2 |
| 登录 / 鉴权 / JWT 两步流 / 行级权限 / 多租户 | demo 无鉴权直查（§7）；换真路径 §12.2 |
| 用户问题溯源（固化标题不含提问文本） | §9 已论证后置（多轮对话难溯源、手写查询无问题文本）；§16 的 title 是 LLM 按查询提炼，非问题原文 |

## 16. 固化默认标题自然语言化（2026-09-26 拍板，方案 B）

### 16.1 问题

`defaultTitle()`（§9）是 annotation 成员 title 的机械拼接，产出形如
「票据审验（交付视图） 开票份数 按 票据审验（交付视图） 单位名称」——列名堆砌，
不是「各单位票据核销情况」式的自然语言。根因：**业务意图不在模型里，在对话里**——

| 丢失的语义 | 例子 | 去哪了 |
|---|---|---|
| 业务意图 | 「各单位**核销情况**」 | 只存在于提问文本 |
| filter 含义 | `state=2` = 已审验 = 「**已**核销」 | annotation title 是通用口径：`inv_num`「开票份数」在该查询语境实为「已核销票据份数」（分子口径） |
| 冗余 | view 前缀「票据审验（交付视图）」出现两次 | 拼接结构 |

### 16.2 方案选型

| 方案 | 处置 | 理由 |
|---|---|---|
| A 前端 DOM 回溯问题文本 | ❌ 弃 | ext-chat 答案卡与 user 消息同容器可回溯拿到问句原文，但清洗规则 imperfect、标题质量 = 问句原文质量 |
| **B answer 契约加 title 字段** | ✅ 选（2026-09-26 拍板） | LLM 手上有全部语义（查询 + 口径拍板 + assumption），顺手产出一句话标题质量最高；filter 语义（已核销）能进标题 |
| C 建模层优化 annotation title | ❌ 弃 | 只能去冗余，到不了自然语言 |

### 16.3 设计（3 处改动）

> 初估 4 处，实核 SKILL.md 未定义三态 JSON 外壳——唯一定义处是 chat_server.py
> 约束 3（CLAUDE_INSTRUCTION），skill 不用动。

1. **`chat/chat_server.py` 约束 3**：answer JSON 模板加 `"title"` 字段，附说明——
   概括整个答案的一句话自然语言标题（≤30 字），含口径关键语义（如 filters
   决定的「已核销」），不要列名堆砌（例：「各单位票据核销情况（已核销份数）」）
2. **`playground-ext/ext-chat.js`** `renderAnswer()`：`data-ext-query` 载体旁加一行
   `data-ext-title`（同 §9 v5 载体先例，ext-chat 只加不改）
3. **`playground-ext/ext-publish.js`** `injectPubBtn()`：click 里再取
   `msg.getAttribute('data-ext-title')` 传 `openDialog(q, title)`；对话框默认标题 =
   `title || defaultTitle(...)`——`defaultTitle()` 本身一行不动

> **2026-09-27 修订（tables 平等契约，17 号文档）**：①「多口径答案 title 跟主口径」
> 废除——答案级 title 改为**概括整个答案**（一句话覆盖全部口径，如「各单位各项目
> 及各预算科目收入」）；②多口径时每张表自带表级 `tables[].title`（「口径A：单位×项目」
> 式），**固化默认标题改用表级 title**（固化按钮表级化：点哪张固哪张，取该表的
> query＋title）；③改动 2/3 的消息级 `data-ext-query`/`data-ext-title` 载体随之
> 表级化，答案级 title 降为单表答案/无表级 title 时的回退。

**回退链**：title 缺失（存量消息卡 / LLM 漏给 / 契约漂移）→ 现有 annotation 拼接；
手写查询固化（ext-drill 捕获路径，不经聊天）→ annotation 拼接；对话框手改始终第一优先。

**明确不做**：无 A 层兜底（仅 B，拍板时明确）；qa-log.jsonl 不加 title（最小范围）；
11 号文档不同步（2026-09-26 拍板：设计仅写 15 号）。

### 16.4 验证清单

1. 重启 chat 桥：停旧进程（:4100）→ `python chat\chat_server.py`；Cube 容器不动，
   ext-* 前端浏览器强刷即生效（volume 挂载实时读）
2. 问一句「查看各单位核销情况…」→ 答案卡点固化 → 对话框默认标题应为一句话
   （「各单位票据核销情况」类），不再是列名拼接
3. 反例：旧答案卡（title 无）固化 → 回退列名拼接（预期）；
   `tail logs/bridge-*.log` 看 answer JSON 已含 title
4. 手写查询（builder → ext-drill 捕获路径）固化 → 不受影响，仍 annotation 拼接
