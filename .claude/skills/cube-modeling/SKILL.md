---
name: cube-modeling
description: 本地建模与改模型：编辑 conf/model 下的 cube/view YAML，容器热编译验证、meta 核对、冒烟查询。凡要新增或修改成员（度量/维度/计算字段）、建 cube 或 view、join 两个 cube、修模型报错、调整口径、维护 ai_context 与术语对照块时使用。触发词：建模、改模型、加个度量、加个维度、建 view、补成员、改口径、修模型报错。问数（只查不改）走 cube-ask。
---

# cube-modeling：本地建模契约（写入 conf/model）

目标：把业务口径落成可查询的语义层成员——**口径可追溯、数字可复算、描述只留当前真相**。
骨架参考官方 `cube-build-model`，操作面本地化：Cube Core 容器 + 本地 YAML，
没有云端 dev 分支——热编译就是咱们的 validate 循环。

职责分界：问数走 cube-ask（只查不改）；本 skill 负责建模层的一切写入；
agent-api 契约代码不在本 skill 范围内。

## 铁律：建模层描述只写当前口径

description / ai_context / 术语对照块，**只写"当前正确的口径"**：

- 禁止入建模层：轮次号、日期、拍板标记、"旧 X 不再 Y"式历史对照
- 历史归 docs/——建模层是问数 LLM 的口径唯一真相，不携带编年史
- 用户口述的口径定义，原话落进 `sql` 和 `description`，不只留在聊天里
- 拍板判据落地三验齐：①**成员实现**——存在可绑定成员，sql/filters 即判据本身
  （判据只出现在描述/对照文本里 = 未落）；②**术语对照导航**——题面词指向该成员；
  ③**冒领清扫**——grep 全库 title/description 的主题词，"×类问题的指标"字样
  只许出现在实现它的成员上。
- 术语对照块格式：`术语=成员/口径（勿混：×）`；只引用已有成员，不发明成员；
  兄弟视图留一行勿混指针
- 目录面判别窗：`/agent/meta` 目录面只透 ai_context 前 100 字符，主题判别词必须落进前 100 字
- description 内禁花括号 `{...}`——编译器当模板吞掉，报 description=null 编译错

**自检**：`grep -rnE 'round-|拍板|不再|旧口径|20[0-9][0-9]-|q[0-9]+|批[0-9]|场景[0-9]+|xls#|号方案|号文档|初步设计|§' conf/model`
应零命中（术语对照的「勿混」格式词除外）。

## 绑定唯一入口

每个业务主题（同一题面应命中的口径）在消费面只允许一个绑定入口。
同一主题出现在两个视图/两个成员 = 建模缺陷，处置是收敛成唯一入口，
不是加指针让两者共存。

- **建模前查重**：新成员落笔前先搜兄弟视图同主题成员（meta 全量按主题词过一遍），
  已有入口就扩展它，或先定主再动工——不制造第二个入口
- **定主判据**：①数据权威（名称列全填 > 宽表回填列）；②金额可答性
  （配不出主题对应度量的一侧，根本答不了这题）；③对数（覆盖率/值域，
  金额粒度不同不可直比，只比值域与覆盖）
- **收敛动作**：输家撤 view includes（cube 层留原料）——透出面消失即不可绑，
  错误从偶发变不可能
- **过渡护栏**：定主已定、撤成员未做时，可在输家 ai_context 写重定向指针、
  拆词防翻车——临时手段非终态；同一主题翻车两次 = 必须完成收敛

## 公共前置（就绪、令牌、热编译）

- 容器由 docker-compose 起（`cube` 容器，:4000）；`CUBEJS_DEV_MODE=true`，
  schema 文件改动免重启热编译，编译报错看 `docker logs --tail 50 cube`
- 探活：`curl -s http://localhost:4000/agent/tools`——200 且工具清单可解析 = 就绪
- token 取 `.env` 的 `CUBEJS_API_SECRET`（每会话 grep 一次，只进请求头，不落任何文件）：
  `TOKEN=$(grep -E '^CUBEJS_API_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')`

## 写之前先读

永远不要对着想象中的模型写：

1. **消费面现状**：`GET /agent/meta`（目录面）、`GET /agent/meta/{topic}`（成员全集
   + ai_context + folders，成员名 = `cube.member` 限定名）
2. **缺口清单**：`GET /agent/unmodel/{cube}`——未盘点 / reserve 档直接决定补建模量级
3. **读邻居**：同目录既有 cube/view 的命名、文件布局、join 声明、ai_context 结构。
   写法正确但和邻居长得完全不一样的 cube 是坏贡献
4. **源库探查**：CK 列面走 `system.columns`（连接必须 `?database=yunnan0508`），
   Oracle 走 jdbsee；引用字段以源库实测为准，不以文档记载为准
5. **歧义口径必须用户拍板**，拍板结论按术语对照格式落 ai_context——落进去的是
   口径本身，不是拍板过程

## 建模工作流（本地循环）

1. **定位与口径**：meta 面定主题与既有成员；分叉口径让用户拍板后落术语对照
2. **写/改 YAML**：cubes = 物理层（一 cube 一文件，文件名同 cube 名）；views = 消费面
   （业务用度量、暴露面、术语对照都在 view）；join 声明形态贴邻居
3. **编译验证**：存盘后热编译，错误在容器日志——**报错原样呈现，不猜因**；
   修好再进下一步
4. **meta 核对**：`GET /agent/meta/{topic}` 里新成员出现且全名正确；view includes
   未列的成员、`public:false` 的成员不透出——编译绿 ≠ 暴露
5. **冒烟**：`POST /agent/query` 跑真实查询（body 落盘 `regress/tmp-*`，用后即删；
   含中文必须落盘），数字对源库直查或既有基线——**编译绿 ≠ 正确**，SQL 错的
   度量也能完美编译

第 5 步通过后跑铁律节自检，建模收尾。

## 环境事实速查（建模时直接吃，勿再探）

- 容器 cwd=`/cube/conf`，docker exec 一律绝对路径，git-bash 侧加 `MSYS_NO_PATHCONV=1`
- 驱动强制 `join_use_nulls=1`：反连接（排除型）一律 NOT IN 形态，`=''` 判定在 cube
  运行时全灭
- CK 23.3 无 `addDate()/subDate()`：timeShift 走 cube-patch 挂载补丁（`date ± INTERVAL`
  运算符形态），升级 CK 前勿删挂载
- 聚合别名与源列同名时 CK 的 WHERE 解析成别名 → ILLEGAL_AGGREGATION：限定表名
  或别名换名规避
- folders 结构只收 `name` + `includes`；侧别字样进 ai_context
- 跨策略行过滤取**并集**（OR）；需 AND 时单策略内嵌套
- 成员别名超 30 字节 → `ora_name_too_long`
- 预聚合三要素：indexes + 数组形态 + Store 目录挂 named volume（NTFS rename 崩）；
  改 measure/join 后预聚合要重建才算数

## 出错时怎么办

| 症状 | 原因 / 处置 |
| --- | --- |
| description=null 编译错 | description 里有 `{...}` 被当模板吞掉 |
| `ora_name_too_long` | 成员别名超 30 字节，改短名 |
| 编译绿但成员在 meta 查不到 | view includes 未列 → 补列；`public:false` → 改可见性 |
| `ILLEGAL_AGGREGATION` | 聚合别名与源列同名遮蔽，WHERE 限定表名或换名 |
| 反连接结果全空 | `join_use_nulls=1` 语义，改 NOT IN 形态 |
| 冒烟数字与源库不符 | 口径错——回读术语对照与邻居写法，**改口径不改数** |
| 拍板口径绑不上、被别的口径顶替 | 判据只落了文本——补实现成员 + 冒领清扫（铁律"落地三验"） |
| 预聚合不命中 | 三要素缺一，或改了 measure/join 未重建 |
| 同主题两视图都命中、绑定随机翻车 | 违反绑定唯一入口——定主后撤输家 view includes |
