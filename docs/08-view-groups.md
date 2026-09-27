# View Groups（视图分组）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/view-group

## 是什么

View group 把多个 view 组织成**命名集合**，让数据消费方（含 AI 代理、嵌入式分析、可视化工具）更快发现相关视图。

通过 `/v1/meta` API 以顶层 `viewGroups` 数组返回；属于至少一个分组的 view 自身也带 `viewGroups` 字符串数组。

## 基本结构

每个 view group 必须有 `name`：

```yaml
view_groups:
  - name: sales
    title: Sales
    description: Revenue and order views for the sales team
    includes:
      - orders_overview    # 引用 view 名
      - revenue
```

## 参数

- **`name`**：标识符，在部署内所有 view group 中唯一。
- **`title`**：人类可读显示名。
- **`description`**：描述。
- **`includes`**：属于该分组的 view 列表；也可以包含**嵌套 view group**（各自带 title/description/includes）。

## 示例（含嵌套）

```yaml
view_groups:
  - name: sales
    title: Sales
    includes:
      - orders_overview
      - revenue
  - name: enterprise_sales
    title: Enterprise Sales
    description: Views for the enterprise sales team
    includes:
      - enterprise_deals
```

## 关联方式

把 view 的名字列在 view group 的 `includes` 参数中即可；一个 view 可以属于多个分组。
