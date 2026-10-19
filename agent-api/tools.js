'use strict';
/**
 * GET /agent/tools——27 文档 §5/#6：工具自描述，兼探活与启动握手
 * （200 + 本清单可解析 = 服务就绪；匿名 scope，无需令牌）。
 *
 * 口径知识下沉的落点：组装规则 / 错误分类 / 截断协议 / 词典协议全部
 * 写在这里，框架侧 system prompt 只做薄壳；模型级口径（分组用哪个
 * 成员、金额算哪列）唯一真相在 /agent/meta 的 ai_context。
 */

module.exports = {
  service: 'cube-agent-api',
  contract: 'agent-contract/1',
  generatedAt: new Date().toISOString(),
  probe: { ok: true },
  auth: '除本端点外一律 Authorization: Bearer <CUBEJS_API_SECRET>（token 只在服务端流转，不落前端）',
  mcp: { status: 'P2 预留', endpoint: '/agent/mcp', note: '未注册，当前访问 403' },

  tools: [
    {
      name: 'meta_catalog',
      endpoint: 'GET /agent/meta',
      description: '全量主题目录面（views 优先，2–5KB 整包）。问数第 2 步"看见模型"入口：据此判定"查不查得了"（相关性判断归智能体，Cube 侧不做按问聚焦）。',
    },
    {
      name: 'meta_members',
      endpoint: 'GET /agent/meta/{topic}',
      description: '单主题成员全集（view 或 cube 名）：cube.member 全名 + title/description + ai_context（模型级口径唯一真相）+ view includes/folders。问数第 3 步"读口径"入口，也是 query 失败后核对成员全名的依据。',
    },
    {
      name: 'query',
      endpoint: 'POST /agent/query',
      body: '{ query: <Cube query>, userId? }',
      description: '查询执行代理。执行层失败返回 200 + { ok:false, error:{type,...} }，错误分类驱动条件步（核对成员 → 收窄范围 → nomatch）。',
      rules: [
        'measures 必填且非空；limit 必填（缺省会被补 10000 并加 notes 提醒）',
        'filters 仅 {member, operator, values} 形态；operator ∈ equals/notEquals（数组即 in 语义）/contains/notContains/gt/gte/lt/lte/set/notSet/inDateRange/beforeDate/afterDate',
        '时间过滤优先 timeDimensions + dateRange；"null" 语义：total 禁止跨口径合计，纯其他方向组聚合为 null 是事实不是错误',
        '分组维度与金额口径以 /agent/meta/{topic} 的 ai_context 为唯一真相（如"分组用编码列、名称列仅跟随展示"这类规则都在那里）',
      ],
    },
    {
      name: 'unmodel',
      endpoint: 'GET /agent/unmodel/{cube}',
      description: '未建模清单（未建模盘点存档）。status="未盘点" 表示该主题从未盘点——nomatch 时只能答"模型里没有"并注明未盘点，不得臆造缺口；有册时 reserve 档"源表有料"可作后续建模候选。',
    },
    {
      name: 'dictionary_lookup',
      endpoint: 'GET /agent/dictionary?term=',
      description: '口径词典：业务词 → 拍板约定。歧义先查词典（整包或按词）；命中即按约定组装 query。legacy:true 词条指向模型重建前的 cube，仅供历史参考，不得直接套用。',
    },
    {
      name: 'dictionary_write',
      endpoint: 'POST /agent/dictionary',
      body: '{ term, cube, rule, alternatives?, decidedAt?, background? }',
      description: '歧义经用户拍板后回写词典（upsert by term，新词条 legacy=false）。维护铁律：只能映射到 ai_context / 成员 description 已提供的选项，不能发明成员；与 ai_context 冲突时以 ai_context 为准并更新词条。',
    },
  ],

  rules: {
    error_classification: {
      member_not_found: '成员全名错（缺前缀/大小写/口径列选错）→ 回 meta/{topic} 核对后重查',
      ora_name_too_long: 'ORA-00972：标识符超 30 字节（Oracle 11g）→ 缩短别名后重查',
      oracle_error: '其他 ORA-xxxx：贴 code 与 message，判断是收窄范围还是 nomatch',
      timeout: '超 120s → 收窄时间范围/减小 limit/改聚合粒度后重查',
      gateway_unreachable: 'loopback 失败（网关未就绪）→ 稍后重试',
      invalid_query: '4xx 契约违规 → 按 query 组装规则修正',
    },
    truncation: 'truncated=true 表示本页截到 limit 上限，不代表全量；需要全量时收窄范围或换聚合粒度，禁止盲目加大 limit 硬拉',
    three_state: 'answer/ask/nomatch 三态输出契约归 agent 表达层（Cube 管数据真相，agent 管表达契约）；tables[].query 必须是完整可回填构建器的 Cube query',
    boundary: '不存在 execute_sql/直连库表接口（口径红线）：Oracle 只被 Cube 摸；原生 /cubejs-api/v1/* 一行不动',
  },
};
