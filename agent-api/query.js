'use strict';
/**
 * POST /agent/query——27 文档 §5/#3：loopback /load + 错误分类 + truncated
 * 标注 + hitPreAgg 命中自报。
 *
 * 请求体：{ query: <Cube query>, userId? }。userId 本期留位
 * （securityContext 实装后透传，27 §5 后续留位）。
 * loopback：POST http://127.0.0.1:4000/cubejs-api/v1/load，body 形态
 * { query }（本项目旧 CLI 验证过的包裹形态）；同进程绕 127.0.0.1，无
 * 外部依赖。执行层失败一律 200 + { ok:false, error:{type,...} }——错误
 * 分类是给 agent 的条件步输入，不藏在状态码里；契约违规（measures 空、
 * JSON 坏）才是 4xx。
 */

const LOAD_URL = process.env.AGENT_API_LOAD_URL || 'http://127.0.0.1:4000/cubejs-api/v1/load';
const TIMEOUT_MS = Number(process.env.AGENT_API_QUERY_TIMEOUT_MS || 120000);
const DEFAULT_LIMIT = 10000;

async function run(params, ctx) {
  const body = ctx.body || {};
  const query = body.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw { httpStatus: 400, error: 'invalid_query', message: '请求体须为 {query: <Cube query>, userId?}' };
  }
  if (!Array.isArray(query.measures) || query.measures.length === 0) {
    throw { httpStatus: 400, error: 'invalid_query', message: 'query.measures 必填且非空（表达契约：tables[].query 须为完整 query，构建器回填依赖）' };
  }
  let limitDefaulted = false;
  if (!query.limit) { query.limit = DEFAULT_LIMIT; limitDefaulted = true; }

  const secret = process.env.CUBEJS_API_SECRET;
  if (!secret) throw { httpStatus: 503, error: 'server_misconfigured', message: 'CUBEJS_API_SECRET 未配置' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res, payload;
  try {
    res = await fetch(LOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    payload = await res.json().catch(() => ({}));
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(String(e)))) {
      throw { httpStatus: 200, error: 'timeout', message: `上游 /load 超时（>${TIMEOUT_MS}ms），可收窄时间范围或减小 limit 后重试` };
    }
    throw { httpStatus: 200, error: 'gateway_unreachable', message: `loopback ${LOAD_URL} 失败: ${(e && e.message) || e}` };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { ok: false, query, error: classify(res.status, payload) };
  }

  const rows = Array.isArray(payload.data) ? payload.data : [];
  const used = payload.usedPreAggregations;
  return {
    ok: true,
    query,
    totalRows: rows.length,
    truncated: rows.length >= query.limit,
    // null = 上游未回告（无法判定）；有值 = { hit, names, extDbType, external }
    hitPreAgg: used ? {
      hit: Object.keys(used).length > 0,
      names: Object.keys(used),
      extDbType: payload.extDbType != null ? payload.extDbType : null,
      external: payload.external != null ? payload.external : null,
    } : null,
    ...(limitDefaulted ? { notes: ['limit 未传，已默认 10000（表达契约要求必传）'] } : {}),
    data: rows,
  };
}

// 错误四分类（27 §3.2）：member_not_found / ora_name_too_long / oracle_error
// / 其他（invalid_query、auth_error、timeout、unknown…）
function classify(status, payload) {
  const text = JSON.stringify(payload || {});
  const msg = (payload && (payload.error || payload.message)) || `上游 HTTP ${status}`;

  // Cube 1.7 两种形态：'Member "X" not found' 与 "'short' not found for path 'view.member'"
  if (/member not found|not found for path/i.test(text)) {
    const found = new Set();
    for (const m of text.matchAll(/["']([A-Za-z0-9_]+\.[A-Za-z0-9_]+)["'](?:\s*not found|)$/gim)) found.add(m[1]);
    for (const m of text.matchAll(/for path ["']([A-Za-z0-9_.]+)["']/gi)) found.add(m[1]);
    return {
      type: 'member_not_found',
      message: typeof msg === 'string' ? msg : '成员不存在',
      ...(found.size ? { members: [...found] } : {}),
      hint: '用 GET /agent/meta/{topic} 核对成员全名（含前缀与 *_code 口径），修正后重查',
    };
  }

  const ora = text.match(/ORA-(\d{4,5})/);
  if (ora) {
    const code = `ORA-${ora[1]}`;
    const isNameTooLong = code === 'ORA-00972';
    return {
      type: isNameTooLong ? 'ora_name_too_long' : 'oracle_error',
      code,
      message: typeof msg === 'string' ? msg : code,
      ...(isNameTooLong ? { hint: '标识符超 30 字节（Oracle 11g 限制）：缩短成员别名或 SQL 别名后重查' } : {}),
    };
  }

  if (status === 400) return { type: 'invalid_query', message: typeof msg === 'string' ? msg : '查询结构不被网关接受', hint: '对照 GET /agent/tools 的 query_assembly 规则修正' };
  if (status === 401 || status === 403) return { type: 'auth_error', message: '上游网关拒绝（token 或 securityContext 问题）' };
  if (status === 404) return { type: 'upstream_not_found', message: '上游 /load 路径不存在（网关形态变化？）' };
  if (status >= 500) return { type: 'upstream_error', message: typeof msg === 'string' ? msg : `上游内部错误 HTTP ${status}` };
  return { type: 'unknown', message: typeof msg === 'string' ? msg : JSON.stringify(payload).slice(0, 300) };
}

module.exports = { run };
