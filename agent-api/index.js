'use strict';
/**
 * /agent 问数契约接口（docs/cube-dataqa-topic/27-cube-AnalyticsChat建设方案.md §3.2/§5）
 *
 * 挂载机制：preload.js require 本文件 → 拦 http.createServer → 认领 /agent/*
 * 命名空间（embed-patch 同款模式），其余请求原样放行给 Cube 网关。
 * 零内部依赖：不 import 网关任何内部模块；/agent/query 内部 loopback 调
 * :4000/cubejs-api/v1/load；meta/unmodel/dictionary 直接读挂载卷 conf/。
 *
 * 鉴权：本地 bearer 中间件，读同进程 CUBEJS_API_SECRET（接受 raw 或
 * Bearer 前缀）；fail-closed 授权表：路由→scope 显式注册，表外一律 403；
 * GET /agent/tools 匿名放行（兼探活与启动握手）。
 *
 * 热更：子 handler 每请求 require.cache 失效 + 懒加载——改 meta/query/
 * unmodel/dictionary/tools 文件即时生效无需重启；改本文件或 preload.js
 * 才需 docker compose restart cube。
 *
 * handler 约定：
 *   - 签名 (params, ctx) → 返回对象（以 200 序列化）；
 *     ctx = { body, searchParams, req }，params = 路由正则捕获组；
 *   - 失败：throw { httpStatus, error, message }（error 结构），无结构
 *     异常一律 500 兜底——绝不向 express/http 层抛。
 */

const http = require('http');
const crypto = require('crypto');

// fail-closed 授权表：method + 路由 → scope。scope 目前只承载结构语义
// （probe 匿名 / write 单列），凭据同一把 CUBEJS_API_SECRET，将来多 token
// 时按 scope 差异化。表外路径 = 未注册 = 403（不 404，显式拒绝）。
const ROUTES = [
  { method: 'GET',  re: /^\/agent\/tools\/?$/,                      scope: 'probe', mod: './tools.js',      fn: null     },
  { method: 'GET',  re: /^\/agent\/meta\/?$/,                       scope: 'read',  mod: './meta.js',       fn: 'catalog' },
  { method: 'GET',  re: /^\/agent\/meta\/([A-Za-z0-9_-]+)\/?$/,     scope: 'read',  mod: './meta.js',       fn: 'members' },
  { method: 'POST', re: /^\/agent\/query\/?$/,                      scope: 'read',  mod: './query.js',      fn: 'run'     },
  { method: 'GET',  re: /^\/agent\/unmodel\/([A-Za-z0-9_-]+)\/?$/,  scope: 'read',  mod: './unmodel.js',    fn: 'run'     },
  { method: 'GET',  re: /^\/agent\/dictionary\/?$/,                 scope: 'read',  mod: './dictionary.js', fn: 'get'     },
  { method: 'POST', re: /^\/agent\/dictionary\/?$/,                 scope: 'write', mod: './dictionary.js', fn: 'post'    },
  // /agent/mcp：P2 预留，未注册 → 表外 403，装上时在此登记
];

function respond(res, status, obj) {
  if (res.headersSent || res.destroyed) return;
  const payload = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(bb, bb); // 等长垃圾比较，抹平长度差时序
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function checkAuth(req) {
  const secret = process.env.CUBEJS_API_SECRET;
  if (!secret) {
    return { ok: false, status: 503, error: 'server_misconfigured', message: 'CUBEJS_API_SECRET 未配置（.env 未加载或变量缺失）' };
  }
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : h.trim();
  if (!token || !safeEqual(token, secret)) {
    return { ok: false, status: 401, error: 'unauthorized', message: '令牌缺失或不匹配（Authorization: Bearer <CUBEJS_API_SECRET>）' };
  }
  return { ok: true };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject({ httpStatus: 413, error: 'payload_too_large', message: '请求体超过 2MB 上限' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(null);
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject({ httpStatus: 400, error: 'invalid_json', message: `请求体不是合法 JSON: ${e.message}` }); }
    });
    req.on('error', reject);
  });
}

// 懒加载 + 缓存失效：handler 文件改完即生效（模块内长命缓存放 globalThis，
// 见 meta.js 的模型 mtime 缓存——模块缓存清了它也不丢）
function loadHandler(mod) {
  const resolved = require.resolve(mod);
  if (require.cache[resolved]) delete require.cache[resolved];
  return require(resolved);
}

async function handle(req, res, pathname) {
  const route = ROUTES.find((r) => r.method === req.method && r.re.test(pathname));
  if (!route) {
    return respond(res, 403, {
      ok: false, error: 'forbidden', reason: 'route_not_registered',
      message: '该路径未在 fail-closed 授权表注册（表外默认拒绝）',
    });
  }

  if (route.scope !== 'probe') {
    const auth = checkAuth(req);
    if (!auth.ok) return respond(res, auth.status, { ok: false, error: auth.error, message: auth.message });
  }

  const params = pathname.match(route.re).slice(1);
  const searchParams = new URL(req.url, 'http://localhost').searchParams;
  const body = req.method === 'POST' ? await readBody(req) : null;

  const mod = loadHandler(route.mod);
  // fn=null 的路由（tools）整个模块即响应体；其余路由按名取 handler
  const result = route.fn
    ? await mod[route.fn](params, { body, searchParams, req })
    : mod;
  return respond(res, 200, result);
}

function claim(req, res) {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname !== '/agent' && !pathname.startsWith('/agent/')) return false;
  handle(req, res, pathname).catch((e) => {
    if (e && e.httpStatus) {
      respond(res, e.httpStatus, { ok: false, error: e.error || 'error', message: e.message || String(e.error || 'error') });
    } else {
      respond(res, 500, { ok: false, error: 'internal_error', message: (e && e.message) || String(e) });
    }
  });
  return true;
}

if (!globalThis.__agentApiMounted) {
  globalThis.__agentApiMounted = true;
  const _createServer = http.createServer;
  http.createServer = function (options, listener) {
    if (typeof options === 'function') { listener = options; options = undefined; }
    const wrapped = function (req, res) {
      let claimed = false;
      try { claimed = claim(req, res); }
      catch (e) {
        respond(res, 500, { ok: false, error: 'internal_error', message: (e && e.message) || String(e) });
        return;
      }
      if (claimed) return;
      return listener(req, res);
    };
    return options === undefined
      ? _createServer.call(http, wrapped)
      : _createServer.call(http, options, wrapped);
  };
  console.error(`[agent-api] /agent routes mounted (${ROUTES.length} routes / 6 endpoints, fail-closed, hot-reload on)`);
}
