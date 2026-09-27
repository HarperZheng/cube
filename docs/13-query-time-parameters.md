# 查询期参数（Query-time Parameters）常用用法

> 参考文档：https://docs.cube.dev/recipes/data-modeling 下的 dynamic-rolling-windows、passing-dynamic-parameters-in-a-query

## 总览表

| 用法 | 解决什么问题 | 核心手段 | 关键点 |
|------|-------------|---------|--------|
| [可配置滚动窗口和时间平移](#1-可配置滚动窗口和时间平移dynamic-rolling-windows) | 让用户查询时自选滚动窗口（如 R3/R6/R9/R12）和时间平移，而不是每个窗口定义一个度量 | switch 维度做"查询期参数" + case 度量按选中值分发 | `rolling_window`/`time_shift` 是模型编译期属性，不能作为查询参数传入；case 度量必须有 `else` 分支，查询必须带上 switch 维度 |
| [在查询中传递动态参数](#2-在查询中传递动态参数passing-dynamic-parameters) | 让用户选一个过滤值（如城市），把该值用于计算而不是过滤整个查询 | cube 的 `sql` 里用 `FILTER_PARAMS` 把过滤下沉到子查询 + 自连接生成"选中值"列 | 用户只能选数据中已存在的值；过滤只作用于单个度量，不影响分母等其他计算 |

两者的区别：第 1 种选择的是**度量行为**（窗口长度），第 2 种选择的是**数据值**（如城市）注入到计算里。

---

## 1. 可配置滚动窗口和时间平移（dynamic-rolling-windows）

**问题**：嵌入式仪表盘有"窗口"下拉框（R3/R6/R9/R12），选中后要改变查询结果。但 `rolling_window` 和 `time_shift` 是**度量定义的属性**，在模型编译时就解析了——不能作为查询参数传入，否则缓存、预聚合匹配和治理全部失效。

**思路**：把选择权移到查询里——用 **switch 维度** 存放可选窗口，作为查询期参数；用 **case 度量** 根据选中值分发到对应的滚动逻辑。

**模型四部分**（以月度 gross_sales 的 3/6/9/12 个月滚动窗口为例）：

1. `growth_window` switch 维度——值即可选窗口（查询期参数）
2. 每个窗口一个 `rolling_window` 度量（当前周期）
3. 每个窗口一个 `time_shift` 度量（把当前周期平移回去，作对比周期）
4. 四个 **case 度量**（current / prior / change / growth_percentage），按 `growth_window` 分发——用户只查这四个

用 Jinja 从一个列表批量生成，加窗口（如 R18）只需改列表一处：

```yaml
{%- set windows = [3, 6, 9, 12] -%}

cubes:
  - name: gross_sales
    dimensions:
      - name: month
        sql: month
        type: time
        primary_key: true

      # 查询期参数：选中的值决定窗口
      - name: growth_window
        type: switch
        values:
        {%- for months in windows %}
          - {{ months }}m
        {%- endfor %}

    measures:
      - name: gross_sales
        sql: amount
        type: sum

      # 每个窗口一个滚动窗口度量（当前周期）
      {%- for months in windows %}
      - name: r{{ months }}_gross_sales
        sql: amount
        type: sum
        rolling_window:
          trailing: {{ months }} month
      {% endfor %}

      # 每个窗口一个时间平移度量（对比周期）
      {%- for months in windows %}
      - name: prev_r{{ months }}_gross_sales
        multi_stage: true
        sql: "{r{{ months }}_gross_sales}"
        type: number
        time_shift:
          - interval: {{ months }} month
            type: prior
      {% endfor %}

      # 用户查询的度量，按 growth_window 分发
      - name: gross_sales_current
        multi_stage: true
        case:
          switch: "{CUBE.growth_window}"
          when:
          {%- for months in windows %}
            - value: {{ months }}m
              sql: "{CUBE.r{{ months }}_gross_sales}}"
          {%- endfor %}
          else:
            sql: "{CUBE.r{{ windows[0] }}_gross_sales}}"
        type: number

      # gross_sales_prior 同理，when 里换成 prev_rN 度量
      - name: gross_sales_change
        multi_stage: true
        sql: "{gross_sales_current} - {gross_sales_prior}"
        type: number

      - name: gross_sales_growth_percentage
        multi_stage: true
        sql: "100.0 * ({gross_sales_current} - {gross_sales_prior}) / NULLIF({gross_sales_prior}, 0)"
        type: number
```

**两个硬性要求**：

- 每个 case 度量**必须有 `else` 分支**（switch 值没匹配任何 when 时取它的值）
- 查询**必须带上 switch 维度**（growth_window）——case 度量和建在它们之上的计算度量靠它分发。固定单窗口时用 filter 过滤它，但不能只靠 filter

**默认窗口**：通过 view 的 `default_filters` + `unless` 给用户一个默认窗口——用户没显式过滤 growth_window 时用默认值，一旦显式过滤就用用户选的：

```yaml
views:
  - name: gross_sales_view
    cubes:
      - join_path: gross_sales
        includes: "*"
    default_filters:
      - member: gross_sales.growth_window
        operator: equals
        values: [3m]
        unless:
          - gross_sales.growth_window    # 用户显式过滤该维度时，默认值失效
```

**查询效果**（SQL API，度量要包 `MEASURE()`，并给滚动窗口提供日期范围）：

```sql
SELECT growth_window, MEASURE(gross_sales_current), MEASURE(gross_sales_prior),
       MEASURE(gross_sales_change), MEASURE(gross_sales_growth_percentage)
FROM gross_sales_view
WHERE month >= '2024-12-01' AND month < '2025-01-01'
  AND growth_window = '9m'      -- 不加此行则走默认窗口 3m
GROUP BY 1;
```

过滤所有值（`IN ('3m','6m','9m','12m')`）可把所有窗口并排返回，用于对比图。

**预聚合**：rollup 列**每窗口的度量**（不是四个 case 度量——case 是多阶段的，rollup 必须点名它分发到的底层度量才能匹配）；switch 维度不用包含，预聚合匹配会把选中的值作用到 rollup 扫描上，不包含还能让 rollup 更小。JS 模型中要通过 `CUBE[...]` 引用成员（字符串不会被记录为成员引用，rollup 会编译成空度量列表、静默匹配不到）。REST API 提供日期范围用 `timeDimensions` 而不是 `inDateRange` filter（后者按普通维度过滤匹配，要求时间维度列在 rollup 的 dimensions 里）。

## 2. 在查询中传递动态参数（passing-dynamic-parameters）

**问题**：想算"某城市女性人数 ÷ 全国总人数"，用户指定城市，但该值只应过滤**分子**这一个度量，不能过滤整个查询（否则分母也变了）。

**思路**：在 cube 的 `sql` 里用 **`FILTER_PARAMS`** 把用户对 city 的过滤下沉到子查询，再**自连接**（cross join）生成一个"选中值"列 `city_filter`——不改变行数，只是每行多一列用户选的值，供度量计算使用：

```yaml
cubes:
  - name: users
    sql: |
      WITH
      city AS (
        SELECT DISTINCT city AS city_filter
        FROM public.users
        WHERE {FILTER_PARAMS.users.city.filter('city')}   -- 用户的过滤只作用在这里
        )
      SELECT city.city_filter, users.*
      FROM city, public.users                              -- 自连接：行数不变，多出选中值列

    measures:
      - name: total_number_of_women          # 分母：不受城市过滤影响
        sql: id
        type: count
        filters:
          - sql: "gender = 'female'"

      - name: number_of_people_in_city       # 分子：用选中值过滤
        sql: id
        type: count
        filters:
          - sql: "city = city_filter"        # city_filter 即用户选的值

      - name: ratio
        sql: |
          1.0 * {number_of_people_in_city} / {total_number_of_women}
        type: number

    dimensions:
      - name: city_filter
        sql: city_filter
        type: string
```

**关键点**：

- `{FILTER_PARAMS.users.city.filter('city')}` 会把用户查询中对 `users.city` 的过滤条件展开到这个位置——所以用户"选城市"的动作只影响子查询里的 city CTE，不影响主表
- 过滤 `city = city_filter` 只出现在单个度量上，所以比值计算的分母保持全国口径
- **限制**：用户只能从数据中已存在的值里选（本质是按用户输入过滤数据，取单值结果参与计算），不是把任意输入注入 SQL——这也是安全上的设计
- 效果：过滤 Seattle → `total_number_of_women=25999, number_of_people_in_city=822, ratio=38.22%` 之类，分母不随城市变
