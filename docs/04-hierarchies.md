# Hierarchies（层级）概念说明

> 参考文档：https://docs.cube.dev/reference/data-modeling/hierarchies

## 是什么

Hierarchy 把多个维度组织成**粒度从粗到细的层级**，让用户可以下钻（drill down）或上卷（roll up）分析。展示依赖可视化工具支持，也可在 Playground 预览。

## 基本结构

每个 hierarchy 必须有 `name` 和 `levels`：

```yaml
cubes:
  - name: users
    sql_table: users
    dimensions:
      - name: state
        sql: state
        type: string
      - name: city
        sql: city
        type: string
    hierarchies:
      - name: location
        title: User Location
        levels:
          - state    # 从粗到细排列
          - city
```

## 参数

- **`name`**：标识符，在 cube 内所有成员中唯一。
- **`title`**：人类可读显示名。
- **`levels`**：层级列表，按**从粗到细**的顺序列出维度。
- **`public`**：API 可见性，默认 `true`。

## 注意事项

- 同一个维度可以出现在多个 hierarchy 中。
- 可以包含 join 进来的其他 cube 的维度（如 `orders.status`）。
- 在 view 中暴露时，把 hierarchy 名放进 view `cubes` 块的 `includes` 里即可（与 measures、dimensions、segments 并列）。
