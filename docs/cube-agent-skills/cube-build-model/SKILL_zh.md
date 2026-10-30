---
name: cube-build-model
description: 编写和修改 Cube 语义模型——在 dev 模式分支上，通过 Cube MCP 工具或 Cube CLI 用 YAML 新增或编辑 cube、view、度量、维度、join 和预聚合，然后提交并构建。凡是想加指标、定义度量或维度、创建 cube 或 view、把两个 cube join 起来、修模型报错、重命名字段、或把字段暴露给业务用户时使用。触发词："add a metric"、"define revenue"、"create a view for"、"expose this field"、"join orders to customers"、"fix the model"、"add a pre-aggregation"。先用 cube-explore-model 读模型。要对结果跑查询用 cube-run-query；要部署或查构建状态用 cube-deploy。
license: Apache-2.0
compatibility: 需要 Cube MCP server（本插件内置的，或 Cube connector）或 Cube CLI，并能访问 Cube Cloud。
---

# 构建和修改 Cube 语义模型

> 本文是 [cube-js/cube-agent-skills](https://github.com/cube-js/cube-agent-skills)
> 官方技能的中文参考译文，原文见同目录 `SKILL.md`。

本技能会写入状态。API 拒绝对任何非 dev 模式分支的文件写入，所以下面的分支流程不是可有可无的仪式——跳过它，每次写入都会失败。

## 选择路径

下文把 Cube MCP 工具写作 `cube:<tool>`：即本插件内置的 `cube` server。通过 Cube connector 使用时，同样的工具会带 connector 的名字。

**如果 Cube MCP 工具可用，就用它们**（本插件的 `cube` server 或 Cube connector）。循环如下：

1. `cube:startDataModelEdit` —— 返回 dev 分支的 `branchName`。把它传给下面每个调用并复用；再次调用会开启一个新的编辑会话。
2. `cube:listDataModelFiles`、`cube:readDataModelFile` —— 写之前先读。
3. `cube:writeDataModelFile` —— 整文件替换。它会重新编译并返回 `valid` 和 `validationError`；修好再写，直到 valid。
4. `cube:getDataModelChanges` —— 审阅 diff。
5. `cube:searchDataModel` 和 `cube:runQuery`（带同一个 `branchName`）—— 确认新成员已暴露、返回的数字正确。
6. `cube:commitDataModelChanges` —— 这步不跑，别人就看不到你的工作。报出它返回的分支名，并提议 `cube:switchUserBranch`。
7. `cube:mergeToDefaultBranch` —— **仅当用户明确要求发布时**才执行。它让变更对所有人实时生效。

新建预聚合时，先用 `cube:getPreAggregationStatus` 检查，再用 `cube:buildPreAggregation` 只构建这一个 rollup，传 dev `branchName`。构建会对数仓跑真实查询。

MCP 工具未连接时用 CLI 路径；要用 `cube deploy` 部署整个本地项目时也用 CLI。「写之前先读」和[写法约定](#写法约定)对两条路径都适用。

## 预检（CLI）

```bash
command -v cube >/dev/null || echo "Cube CLI not installed: curl -fsSL https://raw.githubusercontent.com/cube-js/cube/master/install-cli.sh | sh"
cube whoami || echo "Not authenticated. Interactive: cube login. Headless: set CUBE_API_URL + CUBE_API_KEY."
cube context list   # 写任何东西之前，先确认租户
```

## 写之前先读

永远不要对着想象中的模型写。先拉当前状态——MCP 用 `cube:listDataModelFiles` 和 `cube:readDataModelFile`，CLI 用：

```bash
cube data-model list <deployment> --content --json > /tmp/model.json
```

匹配项目已有的写法——文件布局、命名、度量放在 cube 还是 view 上、join 怎么声明。一个「写法正确但和邻居长得完全不一样」的 cube 是坏贡献。

## dev 模式工作流

```bash
# 1. 看有哪些分支，哪个是部署分支
cube data-model branches <deployment>

# 2. 建一个特性分支
cube data-model create-branch <deployment> <feature-branch>

# 3. 在特性分支上进 dev 模式。这会 fork 一个个人 `dev-…` 分支并【打印它的名字】。
#    记住它——后续写入必须指向它。
cube data-model dev-mode <deployment> <feature-branch>

# 4. 把文件写到 dev 分支
cube data-model put <deployment> model/cubes/orders.yml --file ./orders.yml --branch <dev-branch>
cube data-model put <deployment> model/views/revenue.yml --content - --branch <dev-branch>   # 标准输入

# 5. 验证未提交的工作副本；修好再跑，直到通过
cube validate <deployment> --dev-mode

# 6. 提交——落在 <feature-branch> 上，不是生产
cube data-model commit <deployment> -m "Add revenue view" --branch <dev-branch>

# 7. 等构建完成；失败时以非零码退出
cube deployments build-status <deployment> --branch <dev-branch> --wait

# 8. 结束后退出 dev 模式
cube data-model exit-dev-mode <deployment>
```

**永远不要直接在部署分支上进 dev 模式。**`commit` 会推进到 dev 模式所 fork 自的那个分支，所以「部署分支的 dev 分支」等于直接提交到生产。第 2 步就是让变更保持可评审的关键。

发布是单独一步，且只在用户明确要求时执行：

```bash
cube data-model merge-to-default <deployment> --branch <feature-branch> -m "Add revenue view"
```

它合入部署分支——对所有人实时生效——除非传 `--keep-branch`，否则会删除特性分支。

`--branch` 默认取你当前活跃的 dev 模式分支，所以第 3 步跑过之后通常可以省略。但一个会话里跨多个 deployment 工作时务必显式传——默认值跟着用户走、不跟命令走，很容易写错地方。

其他文件操作，同样的分支规则：

```bash
cube data-model rename <deployment> model/cubes/old.yml model/cubes/new.yml --branch <dev-branch>
cube data-model delete <deployment> model/cubes/dead.yml --branch <dev-branch>
```

## 提交前先验证（CLI）

```bash
cube validate <deployment> --dev-mode            # 你未提交的工作副本
cube validate <deployment> --branch <branch>     # 任意指定分支
```

它在该分支自己的运行时上编译模型，失败时按文件列出错误并以非零码退出。**原样报告错误，不要猜原因**——Cube 的模型错误会指明文件和成员。提交之后，`cube deployments build-status --wait` 是构建的最终裁决。

构建绿了之后，还要确认变更真的可查询。一个度量可以编译通过、却在任何 view 里都没暴露：

```bash
cube meta --selectors '[{"type":"cube","deploymentId":<id>,"environment":"<dev-branch>"}]'
```

然后交给 `cube-run-query` 确认数字是对的。编译通过不等于正确——一个 SQL 写错的度量也能完美构建。

## 改为部署本地项目

当用户的项目就在本地磁盘上、而不是想逐文件编辑时：

```bash
cube deploy <deployment> -m "<message>"   # 上传本地目录并构建
```

这和上面的 dev 模式工作流是**两条不同的路**——它用本地文件整体替换项目。若你处于 dev 模式则落到活跃的 dev 分支，否则落到部署分支，并且**会删除远端存在、本地目录里没有的文件**，除非传 `--keep-missing`。跑之前说清楚会落在哪个分支；一个任务里不要混用两条工作流，真要混用也得先说明。

## 写法约定

- cube 是物理层；view 才是用户查询的面。新业务度量通常放 view 上，或放 cube 上再经 view 暴露。
- 一个 cube 一个文件，文件名与 cube 同名。
- 写 `sql` 表达式时，把用户自己的口径原话回引。用户说「收入不含退款」，这句话就该进 SQL 和 `description`，不能只留在聊天里。

## 出错时怎么办

| 症状 | 原因 |
| --- | --- |
| 写入被拒 | 不在 dev 模式分支上——跑 `cube data-model dev-mode`，用它打印的分支 |
| `validate` 失败 | 真实模型错误——修好指名的文件，重新 validate 后再提交 |
| `not logged in` | 重跑预检；不要重试写入 |
| 提交后构建失败 | 真实模型错误——读构建状态输出，修指名的文件 |
| 构建通过但查不到 | 未在 view 中暴露；查 `cube meta` |
