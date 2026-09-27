/*!
 * ext-drill.js — Playground 一键下钻（docs/cube-dataqa-topic/08 第五节实施设计）
 *
 * 原理（零服务端改动，全部在压缩 bundle 之外）：
 *   ① 包装 window.fetch 拦截 /cubejs-api/v1/load 响应，存 (query, annotation, data)。
 *     实测本版 Playground 走 GET ?query=...&queryType=multi，响应为新格式
 *     { results: [{ query, annotation, data }] }（旧格式 { query, annotation, data } 兼容）
 *   ② 事件委托给结果区数据单元格绑点击——Playground 实际渲染的 styled-components
 *     div 网格（本镜像结果区实测永非 <table>，旧 table 路径已删）；列按
 *     annotation title 匹配表头（列序兜底），行值用拦截的响应原始值（不解析 DOM 显示文本）
 *   ③ 客户端拼下钻查询（等价 resultSet.drillDown()）：drillMembers→dimensions、
 *     行内维度值→equals filters、时间粒度→该桶 dateRange、继承
 *     filters/segments/timezone——POST /v1/load 执行
 *   ④ 自绘 Modal 展示明细，行内值可点→加 filter 重查（切片），面包屑可摘除
 *
 * 约束：不碰 cube 源码与压缩 bundle；本文件经 volume 挂载覆盖进 playground
 * 目录，index.html 副本在 </body> 前注入本引用（见 sync-index.sh）。
 * 降级矩阵（08 文档 5.4）：透视 / ungrouped / 非标准时间粒度 / 未声明
 * drill_members 的度量 → 提示而非静默失败；图表 canvas 不绑点击（二期）。
 */
(function () {
  'use strict';
  if (window.__extDrillLoaded) return;
  window.__extDrillLoaded = true;

  var LOAD_URL = '/cubejs-api/v1/load';
  var ROW_LIMIT = 1000;
  var STD_GRAN = ['day', 'week', 'month', 'quarter', 'year'];

  var origFetch = window.fetch.bind(window);
  var lastResult = null; // 最近一次 /v1/load 的 { query, annotation, data }（last-response-wins）
  var lastAuth = null;   // 页面请求携带的 Authorization（dev 模式为空；生产模式前瞻复用）
  var lastCapture = null; // 调试：最近一次 load 捕获走到哪一步（__extDrill.state 可读）

  /* ---------- 工具 ---------- */

  function getHeader(h, name) {
    if (!h) return null;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(name);
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          if (String(h[i][0]).toLowerCase() === name.toLowerCase()) return h[i][1];
        }
        return null;
      }
      var keys = Object.keys(h);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === name.toLowerCase()) return h[keys[j]];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s,，　]/g, '').toLowerCase();
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.ext-drill-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'ext-drill-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 2600);
  }

  /* ---------- 时间粒度 → 该桶 dateRange（5.2 ③） ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function parseYMD(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? '' : iso));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  function fmtYMD(p) { return p.y + '-' + pad2(p.m) + '-' + pad2(p.d); }

  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function addDays(p, n) {
    var d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  function bucketToRange(iso, gran) {
    var p = parseYMD(iso);
    if (!p) return null;
    if (gran === 'day') { var s = fmtYMD(p); return [s, s]; }
    if (gran === 'week') { // 周一为起点（Cube week 默认）
      var dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0=周日
      var start = addDays(p, -((dow + 6) % 7));
      return [fmtYMD(start), fmtYMD(addDays(start, 6))];
    }
    if (gran === 'month') {
      return [fmtYMD({ y: p.y, m: p.m, d: 1 }), fmtYMD({ y: p.y, m: p.m, d: lastDay(p.y, p.m) })];
    }
    if (gran === 'quarter') {
      var qm = Math.floor((p.m - 1) / 3) * 3 + 1;
      return [fmtYMD({ y: p.y, m: qm, d: 1 }), fmtYMD({ y: p.y, m: qm + 2, d: lastDay(p.y, qm + 2) })];
    }
    if (gran === 'year') return [p.y + '-01-01', p.y + '-12-31'];
    return null; // 非标准粒度 → 禁用（5.4）
  }

  /* ---------- ① 拦截 fetch：拿 (query, annotation, data) ---------- */

  window.fetch = function (input, init) {
    var p = origFetch(input, init);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var own = getHeader(init && init.headers, 'X-Ext-Drill'); // 自己的下钻请求不回捕
      if (!own && url.indexOf(LOAD_URL) !== -1) {
        var h = (init && init.headers) || (input && input.headers);
        var auth = getHeader(h, 'Authorization');
        if (auth) lastAuth = auth;
        lastCapture = { url: url.slice(0, 100), method: (init && init.method) || 'GET', stage: 'seen' };
        p.then(function (res) {
          try { // clone 后异步解析，不阻塞页面取响应
            lastCapture.stage = 'res-' + res.status;
            res.clone().json().then(function (body) {
              // 新格式（queryType=multi）：{ results: [{ query, annotation, data }] }，
              // results[0] 为常规查询（pivot 响应时首个仍是非 pivot）；
              // 旧格式 { query, annotation, data } 直接用
              var picked = null;
              if (body && Array.isArray(body.results)) {
                for (var i = 0; i < body.results.length; i++) {
                  var r = body.results[i];
                  if (r && r.query && r.annotation && Array.isArray(r.data)) { picked = r; break; }
                }
              } else if (body && body.query && body.annotation && Array.isArray(body.data)) {
                picked = body;
              }
              lastCapture.stage = picked ? 'captured' : 'body-mismatch';
              lastCapture.keys = body ? Object.keys(body).slice(0, 8) : null;
              if (picked) lastResult = picked;
            }).catch(function (e) { lastCapture.stage = 'json-error: ' + e.message; });
          } catch (e) { lastCapture.stage = 'clone-error: ' + e.message; }
          return res;
        }).catch(function () { lastCapture.stage = 'fetch-rejected'; });
      }
    } catch (e) { /* 任何异常都不影响页面 */ }
    return p;
  };

  /* ---------- ② 列映射：annotation title 匹配表头（5.3） ---------- */

  var annIdxCache = new WeakMap();

  function buildIndex(ann) {
    var byText = {};
    function add(name, info) {
      [info.title, info.shortTitle, name, name.split('.').pop()].forEach(function (t) {
        if (t && !byText[t]) byText[t] = info;
      });
    }
    var idx = { byText: byText, measures: {}, dims: {}, times: {} };
    Object.keys(ann.measures || {}).forEach(function (m) {
      var a = ann.measures[m] || {};
      var info = {
        name: m, kind: 'measure',
        title: a.title || m,
        shortTitle: a.shortTitle || a.title || m,
        drillMembers: a.drillMembers || [],
      };
      idx.measures[m] = info;
      add(m, info);
    });
    Object.keys(ann.dimensions || {}).forEach(function (m) {
      var a = ann.dimensions[m] || {};
      var info = { name: m, kind: 'dimension', title: a.title || m, shortTitle: a.shortTitle || a.title || m };
      idx.dims[m] = info;
      add(m, info);
    });
    Object.keys(ann.timeDimensions || {}).forEach(function (m) {
      var a = ann.timeDimensions[m] || {};
      var info = { name: m, kind: 'timeDimension', title: a.title || m, shortTitle: a.shortTitle || a.title || m };
      idx.times[m] = info;
      add(m, info);
    });
    idx.keys = Object.keys(byText).sort(function (a, b) { return b.length - a.length; }); // startsWith 长键优先
    return idx;
  }

  function getIndex(ann) {
    var i = annIdxCache.get(ann);
    if (!i) { i = buildIndex(ann); annIdxCache.set(ann, i); }
    return i;
  }

  // 两容器的公共祖先，且距双方均 ≤2 层（超出视为不相干，防止跨区误并）
  function nearLca(a, b) {
    var up = a, da = 0;
    while (up && da <= 2) {
      var dn = b, db = 0;
      while (dn && db <= 2) {
        if (up === dn) return up;
        dn = dn.parentElement;
        db++;
      }
      up = up.parentElement;
      da++;
    }
    return null;
  }

  // 按列成员 + 单元格显示文本在拦截数据里找行（换页/虚拟滚动容错）
  function matchRowData(colMembers, cellTexts) {
    if (!lastResult) return null;
    var data = lastResult.data;
    for (var j = 0; j < data.length; j++) {
      var ok = true;
      for (var i = 0; i < colMembers.length; i++) {
        var m = colMembers[i];
        if (!m || m.kind === 'timeDimension') continue; // 时间列显示格式化文本，跳过校验
        var raw = data[j][m.name];
        if (raw == null) continue;
        var cell = cellTexts[i] || '';
        if (norm(cell) === norm(raw)) continue;
        var fn = parseFloat(String(cell).replace(/[^\d.eE+-]/g, ''));
        var fr = parseFloat(raw);
        if (!isNaN(fn) && !isNaN(fr) && fn === fr) continue; // 千分位/小数格式化
        ok = false;
        break;
      }
      if (ok) return data[j];
    }
    return null;
  }

  /* ---------- ②' div 网格路径（Playground 结果区实测非 <table>） ----------
   * 实测结构（diag12/diag13）：结果区是 styled-components div 网格，类名为构建期
   * 哈希（sc-*）不可依赖；表头 cell（label div + 按钮）文本被拆成多个叶子 span
   * （"agency" "." "name"），叶子级精确匹配必失败 → 按容器 textContent 匹配；
   * 数据行是无类名 wrapper（其孩子为无类名 cell div），与表头 cell 同为行容器
   * P 的直接孩子。定位用 annotation 成员标题做容器级匹配，事件时按几何解析
   * （行内 cell 按 x 序 ↔ 表头按 x 序，严格数量校验防透视误映射）。
   */

  function squash(s) {
    return String(s == null ? '' : s).replace(/[\s.。·，]/g, '').toLowerCase();
  }

  var gridCache = { result: null, maps: [] };
  var gridBuildDbg = null; // 调试：buildGridMaps 中间态（__extDrill.state().gridBuild 可读）

  function buildGridMaps() {
    var maps = [];
    if (!lastResult) return maps;
    var idx = getIndex(lastResult.annotation);
    var bySquash = {};
    idx.keys.forEach(function (k) { bySquash[squash(k)] = idx.byText[k]; });

    // 容器级匹配：label 是拆开的叶子 span，只能按容器 textContent 匹配成员标题
    var cands = [];
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el.children.length || !el.offsetParent) continue;
      var t = el.textContent || '';
      if (t.length > 80) continue; // 行容器/大面积容器不可能是表头 label
      if (bySquash[squash(t)]) cands.push(el);
    }
    // 最深优先：含候选后代的容器剔除（保留 label div，其父才是表头 cell）
    var deepest = cands.filter(function (el) {
      for (var j = 0; j < cands.length; j++) {
        if (cands[j] !== el && el.contains(cands[j])) return false;
      }
      return true;
    });
    // 候选 → 同文本祖先链顶（真正的表头 cell）→ 同父聚类 → P = 行容器。
    // 实测（diag16）表头文本嵌套 3 层同文本容器（SPAN < label div < header cell），
    // 只走一层父级会落到中间层 → 沿同 squash 文本上溯到链顶
    var byP = new Map();
    deepest.forEach(function (label) {
      var s = squash(label.textContent);
      var cell = label;
      while (cell.parentElement && squash(cell.parentElement.textContent) === s) {
        cell = cell.parentElement;
      }
      var P = cell.parentElement;
      if (!P) return;
      var arr = byP.get(P);
      if (!arr) { arr = []; byP.set(P, arr); }
      arr.push({ cell: cell, member: bySquash[s] });
    });
    // 全部簇（先不筛可下钻）——pinned 列会把维度表头拆进独立容器
    var all = [];
    byP.forEach(function (heads, P) {
      heads.sort(function (a, b) {
        return a.cell.getBoundingClientRect().left - b.cell.getBoundingClientRect().left;
      });
      all.push({
        P: P,
        heads: heads,
        headerSet: new Set(heads.map(function (h) { return h.cell; })),
      });
    });
    // pinned 列修正（实测 3 列宽表触发）：维度表头被装进行容器内的 UL 冻结列容器，
    // 与度量表头（行容器直接孩子）分属两个簇 → P 有祖先关系的簇合并（外层吸收
    // 内层 heads），误并由数据行校验兜底（schema 树的并簇匹配不上数据行）
    var clusters = [];
    all.forEach(function (cl) {
      for (var i = 0; i < clusters.length; i++) {
        if (clusters[i].P.contains(cl.P)) {
          clusters[i].heads = clusters[i].heads.concat(cl.heads);
          clusters[i].headerSet = new Set(clusters[i].heads.map(function (h) { return h.cell; }));
          return;
        }
        if (cl.P.contains(clusters[i].P)) {
          cl.heads = cl.heads.concat(clusters[i].heads);
          clusters[i] = cl;
          return;
        }
      }
      clusters.push(cl);
    });
    clusters.forEach(function (cl) {
      cl.heads.sort(function (a, b) {
        return a.cell.getBoundingClientRect().left - b.cell.getBoundingClientRect().left;
      });
    });
    // 兄弟簇合并（实测 4 列 pinned 布局：2 维度 + 2 度量）：维度/度量表头分别装进
    // 各自 display:contents 的 UL.sc-dovzVR（兄弟，互不包含），上面的祖先合并不
    // 触发 → 两簇都只有表头没有数据行 → 校验全失败 → 网格映射整体为 null。
    // 找两簇公共祖先（各自 2 层内）作为候选行容器，合并 heads 后必须能匹配拦截
    // 数据才采纳（数据行校验兜底，防止与侧边栏/查询构建区误并）
    var changed = true;
    while (changed) {
      changed = false;
      outer:
      for (var ci = 0; ci < clusters.length; ci++) {
        for (var cj = ci + 1; cj < clusters.length; cj++) {
          var lca = nearLca(clusters[ci].P, clusters[cj].P);
          if (!lca) continue;
          var mh = clusters[ci].heads.concat(clusters[cj].heads);
          mh.sort(function (a, b) {
            return a.cell.getBoundingClientRect().left - b.cell.getBoundingClientRect().left;
          });
          var cand = { P: lca, heads: mh, headerSet: new Set(mh.map(function (h) { return h.cell; })) };
          if (!validateCluster(cand).hit) continue;
          clusters.splice(cj, 1);
          clusters[ci] = cand;
          changed = true;
          break outer;
        }
      }
    }
    // 孩子多的优先；簇内须有能匹配拦截数据的数据行——schema 树/查询构建区的
    // 同名成员按钮行永远匹配不上（值域不同），决定性排除误绑
    clusters.sort(function (a, b) { return b.P.children.length - a.P.children.length; });
    gridBuildDbg = { candidates: cands.length, deepest: deepest.length, clusters: [] };

    function validateCluster(cl) {
      var mismatch = 0;
      for (var ri = 0; ri < cl.P.children.length; ri++) {
        var row = cl.P.children[ri];
        if (cl.headerSet.has(row)) continue;
        var cells = Array.prototype.filter.call(row.children, function (cc) {
          return cc.getBoundingClientRect().width > 0;
        });
        if (cells.length !== cl.heads.length) { mismatch++; continue; }
        var colMembers = cl.heads.map(function (h) { return h.member; });
        if (matchRowData(colMembers, cells.map(function (cc) { return cc.textContent; }))) {
          return { hit: true, mismatch: mismatch };
        }
      }
      return { hit: false, mismatch: mismatch };
    }

    // 可下钻网格（有声明 drill_members 的度量列）优先选定；一个都没有时兜底绑
    // 最佳普通网格——支撑"无度量列/未声明 drill_members"场景的点击提示（不再完全静默）
    var best = null, fallback = null;
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c];
      var drillable = cl.heads.some(function (h) {
        return h.member && h.member.kind === 'measure' && h.member.drillMembers.length;
      });
      var v = validateCluster(cl);
      gridBuildDbg.clusters.push({
        pKids: cl.P.children.length,
        cols: cl.heads.map(function (h) { return h.member ? h.member.name : null; }),
        rowHit: v.hit,
        cellMismatch: v.mismatch,
        drillable: drillable,
      });
      if (!v.hit) continue;
      if (drillable) { cl.drillable = true; best = cl; break; }
      if (!fallback) fallback = cl;
    }
    if (!best && fallback) { fallback.drillable = false; best = fallback; }
    if (best) maps.push(best);
    return maps;
  }

  function currentMaps() {
    // 缓存失效：lastResult 换了，或 React 在同一响应下重建结果区（缓存 P 成死节点）
    var stale = gridCache.result !== lastResult ||
      (gridCache.maps.length && !gridCache.maps[0].P.isConnected);
    if (stale) {
      gridCache = { result: lastResult, maps: buildGridMaps() };
    }
    return gridCache.maps;
  }

  function bindGridMap(map) {
    if (map.P.dataset.extDrill) return;
    if (map.P.closest && map.P.closest('.ext-drill-overlay')) return; // 跳过自绘 Modal
    map.P.dataset.extDrill = '1';
    map.P.addEventListener('mouseover', onGridOver);
    map.P.addEventListener('mouseout', onGridOut);
    map.P.addEventListener('click', onGridClick);
  }

  // 结果晚于绑定到达等时序：miss 时重扫一次自愈
  function mapFor(container) {
    var maps = currentMaps();
    var m = null;
    for (var i = 0; i < maps.length; i++) {
      if (maps[i].P === container) { m = maps[i]; break; }
    }
    if (!m) {
      gridCache = { result: lastResult, maps: buildGridMaps() };
      maps = gridCache.maps;
      for (var j = 0; j < maps.length; j++) {
        if (maps[j].P === container) { m = maps[j]; break; }
      }
    }
    if (m) bindGridMap(m);
    return m;
  }

  function resolveGrid(map, target) {
    var node = target;
    while (node && node.parentElement !== map.P) node = node.parentElement;
    if (!node || map.headerSet.has(node)) return null; // 表头 cell → 非数据
    var cells = Array.prototype.filter.call(node.children, function (c) {
      return c.getBoundingClientRect().width > 0;
    });
    if (!cells.length || cells.length !== map.heads.length) return null; // 数量不符（如透视）→ 放弃
    cells.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    var r = target.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    for (var i = 0; i < cells.length; i++) {
      var cr = cells[i].getBoundingClientRect();
      if (cx >= cr.left && cx <= cr.right) {
        var head = map.heads[i];
        if (!head) return null;
        return {
          member: head.member,
          cell: cells[i],
          cellTexts: cells.map(function (c) { return c.textContent; }),
        };
      }
    }
    return null;
  }



  function buildDrillQuery(measureInfo, rowValues) {
    var q = lastResult.query || {};
    if (q.ungrouped) { toast('ungrouped 查询已是原始行，无下钻意义'); return null; }

    var ann = lastResult.annotation;
    var idx = getIndex(ann);
    var nq = {
      dimensions: [],
      measures: [],
      timeDimensions: [],
      filters: JSON.parse(JSON.stringify(q.filters || [])), // 上下文自动继承（含 AND/OR 嵌套）
      limit: ROW_LIMIT, // 注意：请求不能带 rowLimit（实测网关拒绝 is not allowed）
    };
    if (q.timezone) nq.timezone = q.timezone;
    if (q.segments && q.segments.length) nq.segments = q.segments.slice();

    var handled = {};
    var badGran = null;
    (q.timeDimensions || []).forEach(function (td) {
      if (!td || !td.dimension) return;
      handled[td.dimension] = true;
      if (td.dateRange && td.dateRange.length) {
        nq.timeDimensions.push({ dimension: td.dimension, dateRange: td.dateRange.slice() }); // 已有范围 → 保留
      } else if (td.granularity) {
        if (STD_GRAN.indexOf(td.granularity) === -1) { badGran = badGran || td.granularity; return; }
        var range = bucketToRange(rowValues[td.dimension], td.granularity);
        if (!range) { badGran = badGran || td.granularity; return; }
        nq.timeDimensions.push({ dimension: td.dimension, dateRange: range });               // 粒度 → 该桶范围
      } else {
        var p = parseYMD(rowValues[td.dimension]);
        if (p) nq.timeDimensions.push({ dimension: td.dimension, dateRange: [fmtYMD(p), fmtYMD(p)] });
      }
    });
    if (badGran) { toast('时间粒度 ' + badGran + ' 暂不支持下钻'); return null; }

    (q.dimensions || []).forEach(function (dim) { // 行内维度值 → equals filters
      var v = rowValues[dim];
      if (v !== undefined && v !== null && v !== '') {
        nq.filters.push({ member: dim, operator: 'equals', values: [String(v)] });
      }
    });

    measureInfo.drillMembers.forEach(function (m) { // drillMembers → dimensions；时间维度成员走原始列
      if (idx.times[m]) {
        if (!handled[m]) nq.timeDimensions.push({ dimension: m });
      } else {
        nq.dimensions.push(m);
      }
    });
    if (!nq.dimensions.length && !nq.timeDimensions.length) { toast('下钻声明为空'); return null; }
    return nq;
  }

  /* ---------- ④ 自绘 Modal（样式对齐 antd） ---------- */

  var modalState = null; // { measure, baseQuery, slices: [{ member, value, title }] }

  function injectCss() {
    if (document.getElementById('ext-drill-css')) return;
    var s = document.createElement('style');
    s.id = 'ext-drill-css';
    s.textContent = [
      '.ext-drill-cell{cursor:pointer;outline:2px dashed #1677ff;outline-offset:-2px;background:rgba(22,119,255,.07);}',
      '.ext-drill-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;}',
      '.ext-drill-panel{background:#fff;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.08),0 9px 28px rgba(0,0,0,.05);',
      '  width:min(960px,94vw);max-height:82vh;display:flex;flex-direction:column;font-size:14px;color:rgba(0,0,0,.88);',
      "  font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;}",
      '.ext-drill-head{display:flex;align-items:center;gap:8px;padding:14px 20px;border-bottom:1px solid #f0f0f0;}',
      '.ext-drill-head .t{font-weight:600;font-size:16px;}',
      '.ext-drill-head .sub{color:rgba(0,0,0,.45);font-size:12px;}',
      '.ext-drill-close{margin-left:auto;border:none;background:transparent;font-size:18px;cursor:pointer;color:rgba(0,0,0,.45);}',
      '.ext-drill-close:hover{color:rgba(0,0,0,.88);}',
      '.ext-drill-crumbs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 20px 0;}',
      '.ext-drill-chip{background:#f5f5f5;border:1px solid #d9d9d9;border-radius:4px;padding:1px 8px;font-size:12px;',
      '  display:inline-flex;align-items:center;gap:4px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ext-drill-chip b{font-weight:500;}',
      '.ext-drill-chip button{border:none;background:transparent;cursor:pointer;color:rgba(0,0,0,.45);padding:0 2px;font-size:12px;}',
      '.ext-drill-chip button:hover{color:rgba(0,0,0,.88);}',
      '.ext-drill-body{overflow:auto;padding:12px 20px 20px;}',
      '.ext-drill-body table{border-collapse:collapse;width:100%;font-size:13px;}',
      '.ext-drill-body th,.ext-drill-body td{border:1px solid #f0f0f0;padding:6px 10px;text-align:left;white-space:nowrap;}',
      '.ext-drill-body th{background:#fafafa;font-weight:500;position:sticky;top:0;z-index:1;}',
      '.ext-drill-body td.slicable{cursor:pointer;}',
      '.ext-drill-body td.slicable:hover{background:rgba(22,119,255,.08);}',
      '.ext-drill-loading,.ext-drill-error{padding:24px;text-align:center;color:rgba(0,0,0,.45);}',
      '.ext-drill-error{color:#cf1322;}',
      '.ext-drill-foot{padding:8px 20px;border-top:1px solid #f0f0f0;color:rgba(0,0,0,.45);font-size:12px;}',
      '.ext-drill-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:10000;',
      '  background:rgba(0,0,0,.75);color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function ensureModalRoot() {
    var root = document.querySelector('.ext-drill-overlay');
    if (!root) {
      root = document.createElement('div');
      root.className = 'ext-drill-overlay';
      root.innerHTML =
        '<div class="ext-drill-panel">' +
        '  <div class="ext-drill-head"><span class="t"></span><span class="sub"></span>' +
        '    <button class="ext-drill-close" title="关闭">&times;</button></div>' +
        '  <div class="ext-drill-crumbs"></div>' +
        '  <div class="ext-drill-body"></div>' +
        '  <div class="ext-drill-foot"></div>' +
        '</div>';
      document.body.appendChild(root);
      root.querySelector('.ext-drill-close').addEventListener('click', closeModal);
      root.addEventListener('click', function (e) { if (e.target === root) closeModal(); });
      root.querySelector('.ext-drill-panel').addEventListener('click', function (e) {
        var td = e.target.closest && e.target.closest('td.slicable');
        if (td && modalState) {
          modalState.slices.push({ member: td.dataset.member, value: td.dataset.value, title: td.dataset.title });
          runDrill();
        }
      });
    }
    return root;
  }

  function closeModal() {
    modalState = null;
    var root = document.querySelector('.ext-drill-overlay');
    if (root && root.parentNode) root.parentNode.removeChild(root);
  }

  function renderCrumbs(root) {
    var box = root.querySelector('.ext-drill-crumbs');
    var html = '<span class="ext-drill-chip"><b>' + esc(modalState.measure.title) + '</b>&nbsp;下钻</span>';
    modalState.slices.forEach(function (s, i) {
      html += '<span class="ext-drill-chip" data-i="' + i + '"><b>' + esc(s.title) + '</b>: ' +
        esc(s.value) + '<button data-i="' + i + '" title="移除">&times;</button></span>';
    });
    if (modalState.slices.length) {
      html += '<span class="ext-drill-chip"><button id="ext-drill-clear">清除过滤</button></span>';
    }
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('button[data-i]'), function (btn) {
      btn.addEventListener('click', function () {
        modalState.slices.splice(+btn.dataset.i, 1);
        runDrill();
      });
    });
    var clear = box.querySelector('#ext-drill-clear');
    if (clear) clear.addEventListener('click', function () { modalState.slices = []; runDrill(); });
  }

  function renderTable(root, body) {
    var bodyEl = root.querySelector('.ext-drill-body');
    var ann = (body && body.annotation) || {};
    var cols = [];
    modalState.baseQuery.dimensions.forEach(function (m) {
      var a = (ann.dimensions || {})[m] || {};
      cols.push({ member: m, title: a.title || a.shortTitle || m, kind: 'dimension' });
    });
    modalState.baseQuery.timeDimensions.forEach(function (td) {
      if (td.granularity) return; // 纯 dateRange 是过滤器，不出列
      var a = (ann.timeDimensions || {})[td.dimension] || {};
      cols.push({ member: td.dimension, title: a.title || a.shortTitle || td.dimension, kind: 'timeDimension' });
    });

    var rows = (body && body.data) || [];
    var html = '<table><thead><tr>';
    cols.forEach(function (c) { html += '<th>' + esc(c.title) + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>';
      cols.forEach(function (c) {
        var v = row[c.member];
        // 时间维度列不参与 equals 切片——filters 拼完整时间戳 Oracle 拒绝（ORA-01830 实测）
        var cls = c.kind === 'timeDimension' ? '' : ' class="slicable"';
        html += '<td' + cls + ' data-member="' + esc(c.member) + '" data-value="' + esc(v) +
          '" data-title="' + esc(c.title) + '">' + esc(v) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    bodyEl.innerHTML = rows.length ? html : '<div class="ext-drill-loading">无明细数据</div>';

    var foot = root.querySelector('.ext-drill-foot');
    foot.textContent = '共 ' + rows.length + ' 条' +
      (rows.length >= ROW_LIMIT ? '（已达上限 ' + ROW_LIMIT + '，可能还有更多）' : '') +
      ' · 点击行内值可加条件过滤（切片）';
  }

  function currentQuery() {
    var q = JSON.parse(JSON.stringify(modalState.baseQuery));
    modalState.slices.forEach(function (s) {
      q.filters.push({ member: s.member, operator: 'equals', values: [s.value] });
    });
    return q;
  }

  function runDrill() {
    var root = ensureModalRoot();
    root.querySelector('.ext-drill-head .t').textContent = modalState.measure.title;
    root.querySelector('.ext-drill-head .sub').textContent = '下钻明细';
    renderCrumbs(root);
    var bodyEl = root.querySelector('.ext-drill-body');
    var foot = root.querySelector('.ext-drill-foot');
    foot.textContent = '';
    bodyEl.innerHTML = '<div class="ext-drill-loading">加载中…</div>';

    var headers = { 'Content-Type': 'application/json', 'X-Ext-Drill': '1' }; // X-Ext-Drill 防回捕
    if (lastAuth) headers['Authorization'] = lastAuth;
    origFetch(LOAD_URL, { method: 'POST', headers: headers, body: JSON.stringify({ query: currentQuery() }) })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (!modalState) return;
        if (body && body.error) {
          bodyEl.innerHTML = '<div class="ext-drill-error">查询出错：' + esc(body.error) + '</div>';
          return;
        }
        renderTable(root, body);
      })
      .catch(function (err) {
        if (modalState) {
          bodyEl.innerHTML = '<div class="ext-drill-error">请求失败：' + esc(err && err.message) + '</div>';
        }
      });
  }

  /* ---------- 下钻入口 ---------- */

  function startDrill(measureInfo, rowValues) {
    var nq = buildDrillQuery(measureInfo, rowValues);
    if (!nq) return;
    modalState = { measure: measureInfo, baseQuery: nq, slices: [] };
    runDrill();
  }

  /* ---------- div 网格接线（事件委托绑在行容器 P 上） ---------- */

  var hoverGridEl = null;

  function clearGridHover() {
    if (hoverGridEl) {
      hoverGridEl.classList.remove('ext-drill-cell');
      hoverGridEl.removeAttribute('title');
      hoverGridEl = null;
    }
  }

  function onGridOver(e) {
    var map = mapFor(e.currentTarget);
    if (!map || !lastResult) { clearGridHover(); return; }
    var res = resolveGrid(map, e.target);
    var drillable = !!(res && res.member && res.member.kind === 'measure' && res.member.drillMembers.length);
    if (drillable && res.cell === hoverGridEl) return; // 同格内移动，避免闪烁
    clearGridHover();
    if (drillable) {
      hoverGridEl = res.cell;
      hoverGridEl.classList.add('ext-drill-cell');
      hoverGridEl.setAttribute('title', '点击下钻：查看「' + res.member.title + '」明细');
    }
  }

  function onGridOut(e) {
    var map = mapFor(e.currentTarget);
    if (map && e.relatedTarget) {
      var res = resolveGrid(map, e.relatedTarget);
      if (res && res.cell === hoverGridEl) return; // 仍在同格内
    }
    clearGridHover();
  }

  function onGridClick(e) {
    var map = mapFor(e.currentTarget);
    if (!map) return;
    var res = resolveGrid(map, e.target);
    if (!res || !res.member) return; // 表头/空白 → 非数据单元格
    if (res.member.kind === 'measure' && res.member.drillMembers.length) {
      if (!lastResult) { toast('暂无查询结果'); return; }
      var colMembers = map.heads.map(function (h) { return h.member; });
      var rowValues = matchRowData(colMembers, res.cellTexts);
      if (!rowValues) { toast('无法定位数据行'); return; }
      startDrill(res.member, rowValues);
      return;
    }
    // 不可下钻的点击 → 提示定位；可下钻网格里点维度格仍静默 no-op
    if (res.member.kind === 'measure') {
      toast('度量「' + res.member.title + '」未声明 drill_members，无可下钻明细');
    } else if (map.drillable === false) {
      toast('当前查询未选择可下钻的度量');
    }
  }

  function bindGrids() {
    if (lastResult) currentMaps().forEach(bindGridMap); // div 网格（结果区）
  }

  /* ---------- 调试钩子（Playwright/控制台验证用） ---------- */

  window.__extDrill = {
    state: function () {
      var maps = currentMaps();
      return {
        hasLastResult: !!lastResult,
        query: lastResult && lastResult.query,
        annotation: lastResult && lastResult.annotation, // 只读口：固化默认标题用中文 title（ext-publish）
        measures: lastResult ? Object.keys(lastResult.annotation.measures || {}) : [],
        boundGrids: document.querySelectorAll('div[data-ext-drill]').length,
        lastCapture: lastCapture,
        gridBuild: gridBuildDbg,
        grid: maps.length ? {
          cols: maps[0].heads.map(function (h) { return h.member ? h.member.name : null; }),
          rows: maps[0].P.children.length,
        } : null,
      };
    },
  };

  /* ---------- 启动 ---------- */

  var bindTimer = null;
  var mo = new MutationObserver(function () {
    clearTimeout(bindTimer);
    bindTimer = setTimeout(bindGrids, 150); // 防抖，React 批量渲染后补绑新网格
  });

  function boot() {
    injectCss();
    bindGrids();
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalState) closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
