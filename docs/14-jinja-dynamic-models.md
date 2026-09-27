# Jinja 与动态数据模型（Dynamic Data Models）

> 参考文档：https://docs.cube.dev/docs/data-modeling/dynamic/jinja

## 是什么

Cube 支持在**所有 YAML 数据模型文件**里使用 Jinja 模板语言和 Python，用于：去除模型中的重复模式、按数据源动态生成模型。官方推荐默认用 YAML 语法（简单易读）。

本文的项目实例：`conf/model/globals.py` 就是本项目注册 Python 模板函数的地方（TemplateContext）；12 号文档的 period-to-date 宏、13 号文档的窗口循环都是这里的实际应用。

## 三个易踩的坑（先记住）

| 坑 | 规则 |
|---|---|
| `safe` 过滤器 | 替换值会被自动转义成 JSON 字符串（包上引号）。值**单独作为 YAML 值**时引号无害（`type: "sum"` 能编译）；一旦**与其他文本拼接**（如 `{{ name }}_{{ period }}` → `"revenue"_"week"`）就破坏 YAML 语法。所以：**凡拼接，必加 `\| safe`** |
| `indent` 顺序 | 多行 SQL 宏必须 `\| indent(N) \| safe`——**先 indent 后 safe**。反了的话 indent 返回的新字符串丢掉 safe 标记，SQL 又被加上引号 |
| 报错位置 | 上述错误的 YAML 解析报错**出现在离宏很远的地方**，先做 Jinja Preview 渲染排查 |

## YAML：多行字符串

`sql`、`description` 等多行内容推荐用字面量块 `|`（保留换行）：

```yaml
cubes:
  - name: orders
    description: |
      This cube represents customer orders.
      It includes measures for total sales and order count.
    sql: |
      SELECT id, created_at, total_amount
      FROM staging.orders
```

## Jinja：循环（Loops）

**遍历列表**——生成 SQL 片段（注意每个拼接值都加了 `| safe`）：

```yaml
{%- set nested_properties = ["referrer", "href", "host", "pathname", "search"] -%}

cubes:
  - name: analytics
    sql: |
      SELECT
      {%- for prop in nested_properties %}
        {{ prop | safe }}_prop.value AS {{ prop | safe }}
      {%- endfor %}
      FROM public.events
      {%- for prop in nested_properties %}
      LEFT JOIN UNNEST(properties) AS {{ prop | safe }}_prop ON {{ prop | safe }}_prop.key = '{{ prop | safe }}'
      {%- endfor %}
```

**遍历字典**——批量生成度量：

```yaml
{%- set metrics = { "mau": 30, "wau": 7, "day": 1 } %}

cubes:
  - name: orders
    sql_table: public.orders
    measures:
      {%- for name, days in metrics | items %}
      - name: {{ name | safe }}
        type: count_distinct
        sql: user_id
        rolling_window:
          trailing: {{ days }} day
          offset: start
      {% endfor %}
```

## Jinja：宏（Macros）

`{%- macro 名称(参数) -%}` 定义可复用片段——可生成维度/度量定义，也可生成 SQL 片段。**宏必须先声明后使用**，否则报错：

```yaml
{%- macro dimension(column_name, type='string', primary_key=False) -%}
      - name: {{ column_name }}
        sql: {{ column_name }}
        type: {{ type }}
        {% if primary_key -%}
        primary_key: true
        {% endif -%}
{% endmacro -%}

cubes:
  - name: orders
    sql_table: public.orders
    dimensions:
      {{ dimension('id', 'number', primary_key=True) }}
      {{ dimension('status') }}
      {{ dimension('created_at', 'time') }}
```

生成 SQL 片段的宏（用于 `sql` 属性）：

```yaml
{%- macro cents_to_dollars(column_name, precision=2) -%}
  ({{ column_name | safe }} / 100)::NUMERIC(16, {{ precision | safe }})
{%- endmacro -%}

cubes:
  - name: payments
    sql: |
      SELECT
        id AS payment_id,
        {{ cents_to_dollars('amount') }} AS amount_usd
      FROM app_data.payments
```

### 跨文件复用宏

宏放在 `model/macros/` 下的 `.jinja` 文件里，各数据模型文件用 Jinja 的 `import` 导入（路径**相对 model/ 目录**）：

```
cube/
└── model/
    ├── cubes/orders.yml
    ├── views/
    └── macros/common_dimensions.jinja   # 宏文件
```

`model/macros/common_dimensions.jinja` 里定义宏，然后在 `model/cubes/orders.yml` 中导入使用：

```yaml
{%- import "macros/common_dimensions.jinja" as common -%}

cubes:
  - name: orders
    dimensions:
      {{ common.dimension('id', 'number', primary_key=True) }}
```

> 12 号文档的 `period_to_date.jinja`（period-to-date 宏）就是这个模式的实际应用。

### 宏输出多行 SQL：indent + safe

宏接受 SQL 表达式作参数时，输出为字面量块 `|-` 而非内联——内联文本里的 `{CUBE}`（flow mapping）、`#`（注释截断）、双引号都会被 YAML 误读。多行表达式（如 CASE）还需 `indent` 过滤器，且：

- **indent 的宽度 = 宏里 sql 值行的缩进**（如下例 `sql: |-` 在 8 空格处、值再进 2，所以是 `indent(10)`），不要写死数字
- **先 `indent` 后 `safe`**（`sql | safe | indent(10)` 会丢掉 safe 标记，SQL 被加引号）

```yaml
        sql: |-
          {{ sql | indent(10) | safe }}
```

两种写错的报错都在离宏很远的地方——先用 Jinja Preview 渲染模型排查。

### 转义不安全字符串（Escaping unsafe strings）

自动转义默认开启，作用于**所有替换值**：字符串、循环变量、宏参数、模板里 set 的值。需要 `safe` 的判断标准看值落在哪里：

```yaml
{%- set name = "revenue" -%}
cubes:
  - name: {{ name | safe }}_daily        # 拼接 → 必须 safe
```

Python 侧也可以把字符串包装成 `SafeString` 标记为安全（适合库代码）：

```python
class SafeString(str):
  is_safe: bool

  def __init__(self, v: str):
    self.is_safe = True
```

## Python：TemplateContext

在 `model/globals.py` 里声明函数（用 `@template.function` 装饰器注册到 TemplateContext），Jinja 模板里即可调用——常用于从远程数据源拉取配置、动态生成模型：

```python
from cube import TemplateContext

template = TemplateContext()

@template.function('load_data')
def load_data():
    client = MyApiClient("example.com")
    return client.load_data()
```

```yaml
cubes:
  {%- for cube in load_data()["cubes"] %}
  - name: {{ cube.name }}
    measures:
      {%- for measure in cube.measures %}
      - name: {{ measure.name }}
        type: {{ measure.type }}
      {%- endfor %}
  {%- endfor %}
```

**导入模块**：`globals.py`（或 `cube.py`）可导入当前目录的模块，把结果注册为模板变量：

```python
# model/globals.py
from cube import TemplateContext
from utils import answer_to_main_question

template = TemplateContext()
answer = answer_to_main_question()
template.add_variable('answer', answer)     # 模板里直接 {{ answer }}
```

**依赖**：动态模型需要的第三方库列在部署根目录的 `requirements.txt`，启动时自动 pip 安装。本项目的 `requirements.txt`（oracledb）就是这个机制——且基础镜像不会自动装，已在 Dockerfile 里固化（见 progress.md 1.3）。

## 预览渲染结果（Previewing YAML）

- Playground 的 Data Model 编辑器：含 Jinja 的文件在侧栏点 `… → Jinja Preview` 查看渲染后的模型（仅 Playground 场景可用）
- Cube Core 本地部署暂无预览（官方 issue 跟踪中）
- 替代办法：看 Playground / Visual Model 的最终模型，或调 `/v1/meta` REST API 内省
