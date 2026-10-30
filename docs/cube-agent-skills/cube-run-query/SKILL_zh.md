---
name: cube-run-query
description: 对 Cube deployment 的语义层发起查询并解读结果——MCP 工具已连接时走 Cube MCP 工具，否则在终端走 Cube CLI。凡是想从 Cube 拿数字——拉一个指标、核一个总数、比两个期间、验证某度量返回值是否符合预期、对模型变更做冒烟——都用它。触发词："how many"、"what's the total"、"show me revenue by month"、"did that measure work"、"what's our MoM growth"、"pull the numbers for"，以及任何要求用真实数据验证模型变更的请求。先弄清什么可查用 cube-explore-model；改模型用 cube-build-model；把结果存成报表或看板用 cube-build-content。
license: Apache-2.0
compatibility: 需要 Cube MCP server（本插件内置的，或 Cube connector）或 Cube CLI，并能访问 Cube Cloud。
---

# 对 Cube 发起查询

> 本文是 [cube-js/cube-agent-skills](https://github.com/cube-js/cube-agent-skills)
> 官方技能的中文参考译文，原文见同目录 `SKILL.md`。

## 选择路径

下文把 Cube MCP 工具写作 `cube:<tool>`：即本插件内置的 `cube` server。通过 Cube connector 使用时，同样的工具会带 connector 的名字。

**如果 Cube MCP 工具可用，就用它们。**它们来自本插件的 `cube` server 或 Cube connector——找 `cube:searchDataModel`、`cube:runQuery` 和 `cube:chat`。无需安装或登录步骤，每次调用都以登录用户身份运行，行级安全与 UI 中完全一致。

- **要一个确定的数字：** 先 `cube:searchDataModel` 找到 view 和确切的成员名，再用 Cube SQL 跑 `cube:runQuery`——`SELECT status, MEASURE(count) FROM orders_view GROUP BY 1`。永远不要猜成员名。
- **开放性问题**（「为什么三月注册量跌了」）：用 `cube:chat`，它让 Cube 自家的 agent 在受治理的模型和既有报表上跑。把它返回的 `cubeChatUrl` 交给用户，方便他们回 Cube 继续。
- **另一个 deployment：** 先 `cube:listDeployments`，再传它的 `deploymentId`。
- **dev 分支：** 给 `cube:searchDataModel` 和 `cube:runQuery` 传同一个 `branchName`，保证你找到的成员就是查询所见。
- **超过 100 行：** 用 `offset` 对 `cube:runQuery` 翻页，直到 `hasMore` 为 false。

MCP 工具未连接、或在脚本 / CI 任务里时，用下面的 CLI 路径。[解读结果](#解读结果)对两条路径都适用。

## CLI 路径

CLI 之外的查询步骤。`cube api` 绑定的是 Cube 的 console API，到不了 deployment 的查询端点，所以查询分两步 CLI 调用拿 URL 和 token，然后直接请求 deployment。

### 预检

```bash
command -v cube >/dev/null || echo "Cube CLI not installed: curl -fsSL https://raw.githubusercontent.com/cube-js/cube/master/install-cli.sh | sh"
cube whoami || echo "Not authenticated. Interactive: cube login. Headless: set CUBE_API_URL + CUBE_API_KEY."
cube context list
```

与插件里其他技能不同，这里还需要 `jq` 和 `curl`。先检查，缺了就明说。

### 拿端点和 token

```bash
DEPLOYMENT=<id>
URL=$(cube deployments get "$DEPLOYMENT" --json | jq -r .deploymentUrl)
TOKEN=$(cube deployments token "$DEPLOYMENT")
```

`cube deployments token` 会单独打印 Cube API token；要外层对象就加 `--json`。token 携带调用用户的安全上下文，行级安全与 UI 中完全一致——这里的查询返回的是*该用户*被允许看到的范围，不是全部数据。

### 先弄清能查什么

不要猜成员名。问编译后的模型：

```bash
cube meta --selectors '[{"type":"cube","deploymentId":'"$DEPLOYMENT"',"environment":"production"}]'
```

成员名是 `Cube.member` 或 `View.member`。一个维度存在于 cube 上、却未在 view 中暴露，就不能经该 view 查询——哪个是哪种，`cube meta` 说了算。

### 跑查询

```bash
curl -s "$URL/cubejs-api/v1/load" \
  -H "Authorization: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":{
        "measures":["Orders.count","Orders.totalRevenue"],
        "dimensions":["Orders.status"],
        "timeDimensions":[{"dimension":"Orders.createdAt","granularity":"month","dateRange":"Last 6 months"}],
        "limit":100
      }}' | jq
```

查询结构，按你通常需要的顺序：

- `measures` —— 数字。永远写全限定名。
- `dimensions` —— 按什么拆分。
- `timeDimensions` —— `dimension` 加 `granularity`（`day`/`week`/`month`/…）和 `dateRange`；`dateRange` 接受 `"Last 30 days"` 这类自然区间，或显式 `["2026-01-01","2026-06-30"]`。
- `filters` —— `[{"member":"Orders.status","operator":"equals","values":["paid"]}]`。
- `order`、`limit`。

响应带 `data` 和 `annotation`，后者是每个成员的人类可读标题与格式。展示结果时用 `annotation`——度量的显示名和单位就在这里。

## 解读结果

- **先报数字，再报它是怎么算出来的。**哪个度量、哪个区间、哪些过滤条件。没有查询的数字无法复核。
- **空的 `data` 数组是结果，不是错误。**如实说查询成功但没有行；不要换一个查询重试、把新结果端上来却不提你改过查询。
- **永远不要填入你没有收到的值。**查询失败就报错。

## 验证模型变更

`cube-build-model` 之后的常见场景：合并之前在 dev 分支上查新度量。走 MCP 就给 `cube:searchDataModel` 和 `cube:runQuery` 传 dev `branchName`。走 CLI 时 `$URL/cubejs-api/v1/load` 永远答的是生产；dev 分支在同一个 deployment URL 下有独立端点，用同一个 token：

```bash
cube deployments build-status "$DEPLOYMENT" --branch <dev-branch> --wait
curl -s "$URL/dev-mode/<dev-branch>/cubejs-api/v1/load" -H "Authorization: $TOKEN" ...
```

`cube meta` 同样可以指向分支，把 `"environment"` 换成 `"<dev-branch>"` 即可。

## 出错时怎么办

| 症状 | 原因 |
| --- | --- |
| `deploymentUrl` 为 null | 该 deployment 从未完成过构建；查 `cube deployments build-status` |
| load 端点返回 401 | token 过期——token 都是短命的，重新签一个即可 |
| `Member not found` | 名字错、或未在该 view 暴露——重查 `cube meta`，不要猜变体名 |
| `{"error":"Continue wait"}` | 查询还在跑——原样重发同一请求，直到数据回来。超过一两分钟还这样，要告诉用户 |
