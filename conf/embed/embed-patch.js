/* embed-patch.js — embed 看板路由认领 + 存储 API（docs/cube-dataqa-topic/15 §6/§8）
 *
 * 由 preload.js require（NODE_OPTIONS --require，先于 Cube 一切代码执行）。
 * 拦 http.createServer，在 Cube 路由之前认领两个命名空间：
 *   /cubejs-api/dashboards*  固化写入 / 列表 / 读取（playground ext-publish.js 调用）
 *   /embed/*                 消费面 HTML + vendor 静态资源
 * 其余请求原样放行（playground、websocket、/cubejs-api/v1/* 全不动）。
 * 零依赖：http/fs/path/crypto。demo 无鉴权直查（§7），apiSecret 不进任何页面。
 */
(function () {
  'use strict';

  const CONF_ROOT = '/cube/conf';
  if (!require('fs').existsSync(CONF_ROOT)) {
    console.error('[embed] ' + CONF_ROOT + ' 不存在，不在 cube 容器内，补丁不生效');
    return;
  }

  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const DASH_DIR = path.join(CONF_ROOT, 'dashboards');          // <publicId>.json
  const HTML_PATH = path.join(CONF_ROOT, 'embed/embed-dashboard.html');
  const ECHARTS_PATH = path.join(CONF_ROOT, 'embed/assets/echarts.min.js');
  const MAX_BODY = 2 * 1024 * 1024;                             // 查询定义很小，2MB 足够
  const VIZ = ['table', 'bar', 'line', 'pie', 'number'];
  const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

  const log = (msg) => console.error('[embed] ' + msg);
  const isPublicId = (s) => /^[A-Za-z0-9]{11}$/.test(s);        // 顺带挡路径穿越

  fs.mkdirSync(DASH_DIR, { recursive: true });

  /* publicId：11 位 base62（15 §8，对齐官方形状），撞了重生成 */
  function newPublicId() {
    for (;;) {
      const buf = crypto.randomBytes(11);
      let id = '';
      for (let i = 0; i < 11; i++) id += B62[buf[i] % 62];
      if (!fs.existsSync(path.join(DASH_DIR, id + '.json'))) return id;
    }
  }

  /* 原子写：temp + rename（同目录，rename 在同一文件系统上原子） */
  function atomicWrite(file, data) {
    const tmp = file + '.tmp' + process.pid;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  function sendJson(res, code, obj) {
    res.writeHead(code, JSON_HEADERS);
    res.end(JSON.stringify(obj));
  }

  function readBody(req, cb) {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { cb(new Error('body 超过 2MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { cb(e); }
    });
  }

  /* widget 结构自检（15 §8）：query 原样存档，annotation 不存 */
  function checkWidget(w) {
    if (!w || typeof w !== 'object') return 'widget 缺失';
    if (!w.title) return 'widget.title 缺失';
    if (VIZ.indexOf(w.viz) < 0) return 'widget.viz 必须是 ' + VIZ.join('/');
    if (!w.query || !Array.isArray(w.query.measures) || !w.query.measures.length) {
      return 'widget.query.measures 缺失';
    }
    return null;
  }

  function dashFile(publicId) { return path.join(DASH_DIR, publicId + '.json'); }

  /* 看板存储 API */
  function handleApi(req, res, urlPath) {
    const rest = urlPath.slice('/cubejs-api/dashboards'.length);  // '' 或 '/:publicId'

    if (req.method === 'GET' && rest === '') {
      // 列表：readdir 逐文件解析（15 §8，demo 规模 <100 看板，不建 index）
      const list = [];
      for (const f of fs.readdirSync(DASH_DIR)) {
        if (!f.endsWith('.json')) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(DASH_DIR, f), 'utf8'));
          list.push({ publicId: d.publicId, title: d.title, updatedAt: d.updatedAt });
        } catch (e) { log('跳过坏文件 ' + f + ': ' + e.message); }
      }
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return sendJson(res, 200, list);
    }

    if (req.method === 'POST' && rest === '') {
      return readBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'JSON 解析失败: ' + err.message });
        const bad = checkWidget(body && body.widget);
        if (bad) return sendJson(res, 400, { error: bad });
        const now = new Date().toISOString();
        const publicId = newPublicId();
        const dash = {
          publicId,
          title: (body.title || body.widget.title).toString(),
          createdAt: now,
          updatedAt: now,
          widgets: [Object.assign({ id: 'w1' }, body.widget)],
        };
        atomicWrite(dashFile(publicId), JSON.stringify(dash, null, 2));
        log('新建看板 ' + publicId + ' ← ' + dash.title);
        sendJson(res, 200, { publicId });
      });
    }

    const m = rest.match(/^\/([A-Za-z0-9]{11})$/);
    if (!m) return sendJson(res, 404, { error: '未知路径: ' + urlPath });
    const publicId = m[1];
    const file = dashFile(publicId);

    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: '看板不存在: ' + publicId });
      return sendJson(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
    }

    if (req.method === 'PUT') {
      return readBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'JSON 解析失败: ' + err.message });
        const bad = checkWidget(body && body.widget);
        if (bad) return sendJson(res, 400, { error: bad });
        if (!fs.existsSync(file)) return sendJson(res, 404, { error: '看板不存在: ' + publicId });
        const dash = JSON.parse(fs.readFileSync(file, 'utf8'));
        dash.widgets.push(Object.assign({ id: 'w' + (dash.widgets.length + 1) }, body.widget));
        dash.updatedAt = new Date().toISOString();
        atomicWrite(file, JSON.stringify(dash, null, 2));
        log('追加 widget ' + dash.widgets.length + ' → ' + publicId);
        sendJson(res, 200, { publicId });
      });
    }
    sendJson(res, 405, { error: '方法不支持: ' + req.method });     // 命名空间内全应答，不挂死
  }

  /* 消费面静态资源 */
  function handleEmbed(res, urlPath) {
    let file = null, type = null;
    if (/^\/embed\/dashboard\/[A-Za-z0-9_-]+$/.test(urlPath)) {
      file = HTML_PATH; type = 'text/html; charset=utf-8';        // publicId 由页面自己解析
    } else if (urlPath === '/embed/all') {
      file = HTML_PATH; type = 'text/html; charset=utf-8';        // 聚合模式：所有看板一个网格
    } else if (urlPath === '/embed/static/echarts.min.js') {
      file = ECHARTS_PATH; type = 'application/javascript; charset=utf-8';
    }
    if (!file) return false;                                      // 其余 /embed/* 放行
    if (!fs.existsSync(file)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('embed 文件缺失: ' + file);
      return true;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(file));
    return true;
  }

  /* true=已认领（不再进 Cube 路由）；false/undefined=放行 */
  function claim(req, res) {
    const urlPath = (req.url || '').split('?')[0];
    try {
      if (urlPath === '/cubejs-api/dashboards' || urlPath.startsWith('/cubejs-api/dashboards/')) {
        handleApi(req, res, urlPath);
        return true;                                              // 命名空间内全应答
      }
      if (urlPath.startsWith('/embed/')) return handleEmbed(res, urlPath);
    } catch (e) {
      log('请求处理失败 ' + req.method + ' ' + urlPath + ': ' + e.message);
      if (!res.headersSent) sendJson(res, 500, { error: e.message });
      return true;                                                // 已认领的路径失败不再漏给 Cube
    }
    return false;
  }

  /* 拦 http.createServer（两种参数形态都包），认领失败的一律放行 */
  const origCreate = http.createServer;
  http.createServer = function (a, b) {
    const wrap = (listener) => (req, res) => {
      try { if (claim(req, res)) return; } catch (e) { log('claim 异常: ' + e.message); }
      if (listener) listener(req, res);
    };
    if (typeof a === 'function') return origCreate.call(this, wrap(a));
    if (typeof b === 'function') return origCreate.call(this, a, wrap(b));
    return origCreate.apply(this, arguments);
  };

  log('路由认领就绪：/cubejs-api/dashboards* + /embed/*（其余放行）');
})();
