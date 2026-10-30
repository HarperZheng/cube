---
name: cube-build-content
description: 在 Cube 中创建和更新已保存的内容——工作簿、报表、看板、文件夹和定时通知——通过 Cube MCP 工具或 Cube CLI。凡是想构建或修改别人要看的东西——做个看板、把查询存成报表、加张图、把内容归入文件夹、发布工作簿、或让报表按节奏定时发出——都用它。触发词："build me a dashboard"、"save this as a report"、"add a chart for"、"publish this workbook"、"schedule this weekly"、"move these into a folder"、"duplicate that dashboard"。先找已有内容用 cube-explore-content；保存前先确认查询数字正确用 cube-run-query。
license: Apache-2.0
compatibility: 需要 Cube MCP server（本插件内置的，或 Cube connector）或 Cube CLI，并能访问 Cube Cloud。
---

# 构建 Cube 内容

> 本文是 [cube-js/cube-agent-skills](https://github.com/cube-js/cube-agent-skills)
> 官方技能的中文参考译文，原文见同目录 `SKILL.md`。

本技能会写入状态。报表和看板是大家要看的东西，所以这里出一次错，看到它的不只是犯错的这个人。

## 选择路径

下文把 Cube MCP 工具写作 `cube:<tool>`：即本插件内置的 `cube` server。通过 Cube connector 使用时，同样的工具会带 connector 的名字。

**如果 Cube MCP 工具可用**（本插件的 `cube` server 或 Cube connector），工作簿、报表、看板和文件夹都用它们：

1. 先用 `cube:runQuery` 验证查询——见 `cube-run-query`。
2. `cube:createWorkbook` —— 返回 `workbookId` 和 `url`。用户已指定要建进哪个工作簿时跳过。
3. 用该 `workbookId` 调 `cube:createReport`，一张图一条报表。报表接受 Cube SQL（`sqlQuery`）和 `chartCategory`。只有做独立探索（Sheets 和 Excel 加载项列出的那种）才省略 `workbookId`。
4. `cube:readWorkbook`，然后 `cube:updateDashboard` 把报表排布上去。
5. `cube:publishDashboard` —— 返回上线后的 `url`。交给用户。

修改已有报表用 `cube:readReport` 和 `cube:updateReport` 原地改，不要重建。`cube:manageFolders` 列出和创建文件夹。

定时通知、复制工作簿、把报表接到外部表格，只能走 CLI。这几类用下面的 CLI 路径；MCP 工具未连接时也全部走 CLI。操作顺序和写法约定对两条路径都适用。

## 预检（CLI）

```bash
command -v cube >/dev/null || echo "Cube CLI not installed: curl -fsSL https://raw.githubusercontent.com/cube-js/cube/master/install-cli.sh | sh"
cube whoami || echo "Not authenticated. Interactive: cube login. Headless: set CUBE_API_URL + CUBE_API_KEY."
cube context list
```

## 操作顺序

内容挂在工作簿上，所以从一个工作簿向外建：

1. **先验证查询。**用 `cube-run-query` 跑一遍，确认数字是对的。存错一个查询，等于让错误数字获得了观众。
2. **建或选一个工作簿。**
3. **往里加报表。**
4. **发布成看板**——如果有人要消费它。
5. **排定时**——如果它该按节奏送达。

## 工作簿

```bash
cube workbooks create <deployment> --name "Revenue review"
cube workbooks update <deployment> <workbook> --name "Revenue review Q3"
cube workbooks duplicate <deployment> <workbook>
cube workbooks dashboard <deployment> <workbook> --data '<dashboard-input>'
cube workbooks publish <deployment> <workbook>      # 生成看板
cube workbooks delete <deployment> <workbook>
```

复制一个已有工作簿通常比新建空的好——它继承了团队已经在用的布局和写法。

## 报表

```bash
cube reports create <deployment> --workbook <workbook> --name "Revenue by month" --json-query '<query>'
cube reports update <deployment> <report> --json-query '<query>'
cube reports refresh <deployment> <report>
cube reports delete <deployment> <report>
```

`--json-query` 接受的查询结构和 `cube-run-query` 发给 load 端点的一样——measures、dimensions、timeDimensions、filters。拿你已经验证过的查询，不要重新手打；漏掉一个 filter 往往就出在手打这一步。

复杂请求体走 `-d/--data`，它接受内联 JSON、`@file.json` 或 `-`（标准输入）。专用旗标会覆盖 `--data` 里的同名字段。

`cube reports connect-workbook` 是把报表放进外部表格用的，不是挂到 Cube 工作簿上。后者用：

```bash
cube reports connect-workbook <deployment> <report> --external-workbook-id <id> --result-location <range>
```

## 文件夹

```bash
cube folders create <deployment> --name "Finance"
cube folders update <deployment> <folder> --name "Finance & RevOps"
cube workspace move <deployment> --type WORKBOOK|REPORT|FOLDER --id <id> --folder <folder>   # 省略 --folder 即根目录
cube folders delete <deployment> <folder>
```

## 定时通知

```bash
cube notifications create <deployment> --data '{"scheduleType":"WEEKLY","dashboardPublicId":"<id>","dayOfWeek":1,"hour":9,"timezone":"Europe/London"}'
cube notifications recipients add <deployment> <notification> --data '{"recipients":[{"type":"USER","userId":<id>}]}'
cube notifications recipients list <deployment> <notification>
cube notifications update <deployment> <notification> --data '<UpdateNotificationInput JSON>'
```

`scheduleType` 取 `HOURLY`、`DAILY`、`WEEKLY`、`MONTHLY` 或 `CUSTOM`（配 `customCron`）；`dayOfWeek` 从周日算起 0–6；`hour` 是 `timezone` 时区下的 0–23。接收者的 `type` 取 `USER`、`EMBED_USER` 或 `SLACK`。要完整请求体，`cube spec notification --json` 会打印全部 schema。

改或删一个定时之前，先列出它的接收者，说清楚现在都有谁在收。报表不来了大家会注意到，但几乎没人会联想到是有人改了配置。

## 写法约定

- 命名照用户原话。不要自作主张把「MRR」整理成「Monthly Recurring Revenue」，除非被要求。
- 创建的每样东西都报 id，输出里带 URL 的报 URL。用户的下一步就是打开它。
- 创建成本低，删除不是。请求在「改现有的」和「新建一个」之间含糊时，新建一个并明说。

## 出错时怎么办

| 症状 | 原因 |
| --- | --- |
| 报表保存成功但没有数据 | 查询错了，不是报表——用 `cube-run-query` 验证 |
| `Member not found` | 成员名过期；模型改过了。用 `cube-explore-model` 重查 |
| 发布了但看不到变化 | 工作簿里还没有报表——先加报表 |
| 403 | 账号能读工作区，但没有写权限 |
