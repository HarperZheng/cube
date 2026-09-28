/*!
 * ext-chat.js — Playground 右侧 AI 问数聊天窗（docs/cube-dataqa-topic/11 计划 C2）
 *
 * 原理（chat 服务 = compose 独立 service，本文件只做窗口与渲染）：
 *   ① flex 分栏注入 #/build：从 "Run Query" 按钮沿祖先上爬，找特征 flex 行
 *     （display:flex + 恰好 2 个可见子列：sidebar 250-400px + builder >=800px，
 *     实测 08-drill diag：sidebar 315 + builder 1405）；追加 420px 聊天列，
 *     builder 自动收缩。找不到（非 build 页/未渲染完）→ 右侧 fixed 悬浮兜底，
 *     MutationObserver 防抖自愈 + 升级（路由切换连 tabpane 卸载后自动重挂）。
 *   ② POST http://localhost:4100/chat（chat 服务，CORS 放开）三态响应渲染：
 *     answer → 查询计划 + N 张口径平等的表（tables[]，每表自带标题/query/行/占比列，
 *     17 号文档 tables 平等契约；无表时 answer 文本兜底）+ 口径声明 + 截断/预聚合脚注；
 *     ask → 反问句 + 选项按钮（点击即以该选项追问）；
 *     nomatch/error → 缺口/错误明示（不静默）。
 *   ③ "在构建器中打开"：遍历 React fiber 树找 QueryBuilderContext.Provider 的
 *     value（含 updateQuery 函数，实测 tag 10 react.provider），调
 *     updateQuery({measures,dimensions,filters,timeDimensions,limit}) 填入构建器
 *     ——用户能看到 AI 选了哪些 members，透明可纠正，自己点 Run Query。
 *
 * 约束：不碰 cube 源码与压缩 bundle；本文件经 volume 挂载覆盖进 playground
 * 目录，index.html 副本注入本引用（见 sync-index.sh）。LLM 在 chat 服务端，
 * 前端不持有任何 key；所有动态内容 esc() 转义（XSS 安全，同 ext-drill）。
 */
(function () {
  'use strict';
  if (window.__extChatLoaded) return;
  window.__extChatLoaded = true;

  var CHAT_URL = 'http://localhost:4100/chat';
  var SESSION_ID = 'default'; // v1 单 session（服务内存态）

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortName(member) {
    var i = String(member || '').indexOf('.');
    return i === -1 ? String(member || '') : String(member).slice(i + 1);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.ext-chat-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'ext-chat-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 3200);
  }

  function fmtNum(v) {
    if (v == null || v === '') return '';
    var n = Number(v);
    if (isNaN(n) || typeof v !== 'number' && String(v) !== String(n)) return esc(v);
    return n.toLocaleString('en-US');
  }

  /* ---------- 样式（对齐 antd） ---------- */

  function injectCss() {
    if (document.getElementById('ext-chat-css')) return;
    var s = document.createElement('style');
    s.id = 'ext-chat-css';
    s.textContent = [
      '.ext-chat-panel{flex:0 0 420px;min-width:320px;border-left:1px solid #f0f0f0;display:flex;flex-direction:column;',
      '  background:#fff;font-size:13px;color:rgba(0,0,0,.88);',
      "  font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;z-index:10;}",
      '.ext-chat-panel.ext-chat-fixed{position:fixed;top:56px;right:12px;bottom:12px;width:400px;',
      '  border:1px solid #f0f0f0;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.12);z-index:9998;}',
      '.ext-chat-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #f0f0f0;flex:none;}',
      '.ext-chat-head .t{font-weight:600;font-size:14px;}',
      '.ext-chat-head .sub{color:rgba(0,0,0,.45);font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ext-chat-min{border:none;background:transparent;cursor:pointer;color:rgba(0,0,0,.45);font-size:15px;padding:0 4px;}',
      '.ext-chat-min:hover{color:rgba(0,0,0,.88);}',
      '.ext-chat-msgs{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}',
      '.ext-chat-msg{max-width:96%;border-radius:8px;padding:8px 11px;line-height:1.6;word-break:break-word;}',
      '.ext-chat-msg.user{align-self:flex-end;background:#e6f4ff;border:1px solid #91caff;}',
      '.ext-chat-msg.ai{align-self:flex-start;background:#fafafa;border:1px solid #f0f0f0;}',
      '.ext-chat-msg.err{align-self:flex-start;background:#fff2f0;border:1px solid #ffccc7;color:#cf1322;}',
      '.ext-chat-plan{margin:2px 0 6px;padding:0;list-style:none;}',
      '.ext-chat-plan li{display:flex;gap:6px;padding:1px 0;font-size:12px;color:rgba(0,0,0,.65);}',
      '.ext-chat-plan li b{flex:1;min-width:0;font-weight:500;color:rgba(0,0,0,.88);word-break:break-all;}',
      '.ext-chat-plan .k{flex:none;max-width:40%;color:rgba(0,0,0,.45);word-break:break-all;}',
      '.ext-chat-tblwrap{overflow:auto;max-height:220px;border:1px solid #f0f0f0;border-radius:4px;margin:4px 0 6px;}',
      '.ext-chat-tblwrap table{border-collapse:collapse;width:100%;font-size:12px;}',
      '.ext-chat-tblwrap th,.ext-chat-tblwrap td{border:1px solid #f0f0f0;padding:4px 8px;text-align:left;white-space:nowrap;}',
      '.ext-chat-tblwrap th{background:#fafafa;font-weight:500;position:sticky;top:0;}',
      '.ext-chat-tblwrap td.num{text-align:right;font-variant-numeric:tabular-nums;}',
      '.ext-chat-assump{font-size:12px;color:rgba(0,0,0,.65);margin:2px 0;}',
      '.ext-chat-assump b{font-weight:500;color:#d46b08;}',
      '.ext-chat-foot{font-size:11px;color:rgba(0,0,0,.45);margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 10px;}',
      '.ext-chat-warn{color:#d46b08;}',
      '.ext-chat-tcard{margin:6px 0 8px;padding:6px 8px;border:1px solid #f0f0f0;border-radius:6px;}',
      '.ext-chat-ttitle{font-size:12px;margin:0 0 4px;color:rgba(0,0,0,.45);}',
      '.ext-chat-ttitle b{font-weight:600;font-size:13px;color:rgba(0,0,0,.88);}',
      '.ext-chat-opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
      '.ext-chat-opt{border:1px solid #d9d9d9;background:#fff;border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer;}',
      '.ext-chat-opt:hover{border-color:#1677ff;color:#1677ff;}',
      '.ext-chat-acts{margin-top:6px;display:flex;gap:8px;}',
      '.ext-chat-act{border:1px solid #1677ff;background:#fff;color:#1677ff;border-radius:4px;',
      '  padding:3px 10px;font-size:12px;cursor:pointer;}',
      '.ext-chat-act:hover{background:#e6f4ff;}',
      '.ext-chat-loading{color:rgba(0,0,0,.45);font-size:12px;padding:2px 0;}',
      '.ext-chat-inputbar{flex:none;display:flex;gap:8px;padding:10px 12px;border-top:1px solid #f0f0f0;}',
      '.ext-chat-inputbar textarea{flex:1;resize:none;border:1px solid #d9d9d9;border-radius:6px;',
      '  padding:6px 10px;font-size:13px;font-family:inherit;max-height:96px;min-height:36px;}',
      '.ext-chat-inputbar textarea:focus{outline:none;border-color:#1677ff;}',
      '.ext-chat-send{border:none;background:#1677ff;color:#fff;border-radius:6px;padding:0 16px;',
      '  font-size:13px;cursor:pointer;flex:none;}',
      '.ext-chat-send:disabled{background:#d9d9d9;cursor:not-allowed;}',
      '.ext-chat-fab{position:fixed;right:16px;bottom:48px;z-index:9997;border:1px solid #d9d9d9;background:#fff;',
      '  border-radius:20px;padding:6px 14px;font-size:13px;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.12);}',
      '.ext-chat-fab:hover{border-color:#1677ff;color:#1677ff;}',
      '.ext-chat-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:10000;',
      '  background:rgba(0,0,0,.75);color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- 面板 DOM ---------- */

  var els = null; // { panel, msgs, input, send, fab }

  function ensurePanel() {
    if (els && els.panel) return els.panel;
    var panel = document.createElement('div');
    panel.className = 'ext-chat-panel';
    panel.innerHTML =
      '<div class="ext-chat-head"><span class="t">AI 问数</span>' +
      '<span class="sub">问数契约 · 语义层直查</span>' +
      '<button class="ext-chat-min" title="收起">—</button></div>' +
      '<div class="ext-chat-msgs"></div>' +
      '<div class="ext-chat-inputbar">' +
      '<textarea rows="1" placeholder="问一句，如：不同单位当前的可疑票据种类和数量"></textarea>' +
      '<button class="ext-chat-send">发送</button></div>';
    els = {
      panel: panel,
      msgs: panel.querySelector('.ext-chat-msgs'),
      input: panel.querySelector('textarea'),
      send: panel.querySelector('.ext-chat-send'),
      fab: null,
    };
    // 收起/展开
    panel.querySelector('.ext-chat-min').addEventListener('click', function () {
      panel.style.display = 'none';
      ensureFab().style.display = '';
    });
    // 发送（显式无参调用：submit 的首参是选项文本预设，不能让事件对象混入）
    els.send.addEventListener('click', function () { submit(); });
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    addMsg('ai', '我是票据系统的数据问答助手。直接问一句自然语言，我会给出查询计划、结果表与口径声明；'
      + '口径有歧义时会先反问。结果可以「在构建器中打开」检查并调整。');
    return panel;
  }

  function ensureFab() {
    if (els.fab) return els.fab;
    var fab = document.createElement('button');
    fab.className = 'ext-chat-fab';
    fab.textContent = 'AI 问数';
    fab.style.display = 'none';
    fab.addEventListener('click', function () {
      fab.style.display = 'none';
      els.panel.style.display = '';
    });
    document.body.appendChild(fab);
    els.fab = fab;
    return fab;
  }

  /* ---------- ① flex 分栏注入（08-drill diag 实测锚点法） ---------- */

  function findFlexRow() {
    function btnByText(txt) {
      var all = document.querySelectorAll('button, a, [role="button"]');
      for (var i = 0; i < all.length; i++) {
        if ((all[i].textContent || '').trim().toLowerCase() === txt && all[i].offsetParent) return all[i];
      }
      return null;
    }
    var runBtn = btnByText('run query'); // 锚点：builder 工具栏的 Run Query
    if (!runBtn) return null;
    // 沿祖先上爬找特征 flex 行：display:flex + 2~3 个可见子列（sidebar 250-400 + builder >=800）
    var el = runBtn;
    while (el && el.parentElement) {
      var parent = el.parentElement;
      if (getComputedStyle(parent).display === 'flex') {
        var kids = Array.prototype.filter.call(parent.children, function (c) {
          return c.getBoundingClientRect().width > 0;
        });
        var hasSidebar = kids.some(function (c) {
          var w = c.getBoundingClientRect().width;
          return w >= 250 && w <= 400;
        });
        var hasMain = kids.some(function (c) {
          return c.getBoundingClientRect().width >= 800;
        });
        if (kids.length >= 2 && kids.length <= 3 && hasSidebar && hasMain) return parent;
      }
      el = parent;
    }
    return null;
  }

  /* Dashboard 面板（ext-publish surface）开着 → 聊天走 fixed 浮窗（同 /schema 兜底）：
   * flex 列会被面板盖住（面板 z-index 900 < 浮窗 9998）；面板关闭后升级回 flex 列 */
  function dashSurfaceOpen() {
    return !!document.querySelector('.ext-pub-surface');
  }

  function attach() {
    var panel = ensurePanel();
    if (panel.classList.contains('ext-chat-fixed')) {
      var up = !dashSurfaceOpen() && findFlexRow(); // fixed 模式：尝试升级 flex（Dashboard 面板开着→保持浮窗）
      if (up) {
        panel.classList.remove('ext-chat-fixed');
        panel.style.display = '';
        if (els.fab) els.fab.style.display = 'none';
        up.appendChild(panel);
      }
      return;
    }
    if (!panel.isConnected) {
      var row = !dashSurfaceOpen() ? findFlexRow() : null;
      if (row) {
        row.appendChild(panel); // flex 分栏：builder 自动收缩（实测 1405→985）
      } else {
        panel.classList.add('ext-chat-fixed');
        document.body.appendChild(panel); // 兜底：右侧 fixed 悬浮
      }
    } else if (dashSurfaceOpen()) {
      panel.parentNode.removeChild(panel); // Dashboard 面板开着：flex 列被盖住 → 摘下转浮窗
      panel.classList.add('ext-chat-fixed');
      document.body.appendChild(panel);
    }
  }

  /* ---------- ③ 在构建器中打开（fiber → QueryBuilderContext.Provider） ---------- */

  function fillBuilder(query) {
    var rootEl = document.getElementById('playground-root');
    if (!rootEl) return { ok: false, why: '未找到 playground-root' };
    var key = null;
    var ks = Object.keys(rootEl);
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].indexOf('__reactContainer') === 0) { key = ks[i]; break; }
    }
    if (!key) return { ok: false, why: '未找到 React 容器' };
    var seen = new Set();
    function walk(node) {
      if (!node || seen.has(node)) return null;
      seen.add(node);
      try {
        var p = node.memoizedProps;
        // Provider fiber: memoizedProps = { value, children }
        var v = p && typeof p === 'object' && p.value && typeof p.value === 'object' ? p.value : null;
        if (v && typeof v.updateQuery === 'function' && v.query && typeof v.query === 'object') return v;
      } catch (e) { /* 非 provider 节点忽略 */ }
      return walk(node.child) || walk(node.sibling);
    }
    var ctx = walk(rootEl[key]);
    if (!ctx) return { ok: false, why: '未找到查询构建器上下文（需在 #/build 页）' };
    try {
      // updateQuery 合并语义 {...old, ...new}：全键显式传入以整体替换旧查询
      ctx.updateQuery({
        measures: query.measures || [],
        dimensions: query.dimensions || [],
        filters: query.filters || [],
        timeDimensions: query.timeDimensions || [],
        limit: query.limit || 100,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, why: String((e && e.message) || e) };
    }
  }

  /* ---------- ② 消息渲染（三态） ---------- */

  function addMsg(kind, html) {
    ensurePanel();
    var div = document.createElement('div');
    div.className = 'ext-chat-msg ' + kind;
    div.innerHTML = html;
    els.msgs.appendChild(div);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return div;
  }

  function addLoading() {
    ensurePanel();
    var div = document.createElement('div');
    div.className = 'ext-chat-loading';
    div.textContent = '语义解析 → 组装 → 查询中…';
    els.msgs.appendChild(div);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return div;
  }

  function renderPlan(plan) {
    if (!plan || !plan.length) return '';
    var html = '<ul class="ext-chat-plan">';
    plan.forEach(function (p) {
      html += '<li><span class="k">' + esc(p[0]) + '</span><b>' + esc(p[1]) + '</b>' +
        '<span class="k">' + esc(p[2] || '') + '</span></li>';
    });
    return html + '</ul>';
  }

  function renderTable(query, rows, total) {
    rows = rows || [];
    // 列序按 query：dimensions 先、measures 后（17 号 §3.2，不依赖首行键序）；
    // 行内多出的键尾插不丢（漂移防御）；空结果退回 query 成员
    var cols = [].concat(query.dimensions || [], query.measures || []);
    if (rows.length) {
      Object.keys(rows[0]).forEach(function (k) {
        if (cols.indexOf(k) === -1) cols.push(k);
      });
    }
    if (!cols.length) return '';
    // 占比列（17 号 §3.2）：表内唯一度量 + total 非 null 才加；前端只做除法——
    // 分母用 agent 全量查询提供的 total，绝不自行加总（截断时加总是错的）
    var measures = query.measures || [];
    var pctKey = (total && total > 0 && measures.length === 1 && rows.length &&
                  Object.prototype.hasOwnProperty.call(rows[0], measures[0]))
      ? measures[0] : null;
    var html = '<div class="ext-chat-tblwrap"><table><thead><tr>';
    cols.forEach(function (c) {
      html += '<th title="' + esc(c) + '">' + esc(shortName(c)) + '</th>';
    });
    if (pctKey) html += '<th>占比</th>';
    html += '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>';
      cols.forEach(function (c) {
        var v = row[c];
        // cube 实测度量值为数字字符串（"10021"），Number() 判定而非 typeof
        var numeric = v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
        html += '<td' + (numeric ? ' class="num"' : '') + '>' + (numeric ? fmtNum(v) : esc(v)) + '</td>';
      });
      if (pctKey) {
        var n = Number(row[pctKey]);
        html += '<td class="num">' + (!isNaN(n) ? (n / total * 100).toFixed(2) + '%' : '') + '</td>';
      }
      html += '</tr>';
    });
    return html + '</tbody></table></div>';
  }

  function renderTableCard(t) {
    var query = t.query || {};
    var rows = t.rows || [];
    var trunc = query.limit && rows.length >= query.limit; // 行数==limit → 可能截断
    var html = '<div class="ext-chat-tcard">';
    html += '<div class="ext-chat-ttitle"><b>' + esc(t.title || '结果表') + '</b>' +
      ' · ' + rows.length + ' 行' +
      (trunc ? ' <span class="ext-chat-warn">⚠ 可能截断</span>' : '') + '</div>';
    html += renderTable(query, rows, t.total);
    html += '<div class="ext-chat-acts"><button class="ext-chat-act" data-act="builder">填入构建器</button></div>';
    html += '</div>';
    return html;
  }

  function renderAnswer(d) {
    var html = renderPlan(d.plan);
    // tables 平等契约（17 号）：每口径一张表，结构对称；无表时 answer 文本兜底
    var tables = Array.isArray(d.tables) ? d.tables : [];
    tables.forEach(function (t) {
      html += renderTableCard(t);
    });
    if (!tables.length && d.answer) {
      html += '<div class="ext-chat-assump">' + esc(d.answer) + '</div>';
    }
    if (d.assumption) {
      html += '<div class="ext-chat-assump">口径：<b>' + esc(d.assumption) + '</b></div>';
    }
    var foot = ['共 ' + (d.rows || 0) + ' 行'];
    if (d.audited) foot.push('✓ 已与 Oracle 对数一致');
    if (d.truncated) foot.push('<span class="ext-chat-warn">⚠ 可能截断</span>');
    if (d.hitPreAgg) foot.push('命中预聚合: ' + esc(d.hitPreAgg));
    html += '<div class="ext-chat-foot">' + foot.join('<span>·</span>') + '</div>';
    var div = addMsg('ai', html);
    // 表级载体（17 号 §3.3）：query/title 挂表卡片——构建器/固化（ext-publish 注入，
    // closest 向上找最近载体）都按表取，点哪张固哪张；消息级载体废止
    var cards = div.querySelectorAll('.ext-chat-tcard');
    Array.prototype.forEach.call(cards, function (card, i) {
      var t = tables[i] || {};
      card.setAttribute('data-ext-query', JSON.stringify(t.query || {}));
      card.setAttribute('data-ext-title', t.title || '');
      var btn = card.querySelector('[data-act="builder"]');
      btn.addEventListener('click', function () {
        var r = fillBuilder(t.query || {});
        toast(r.ok ? '已填入构建器：可检查 AI 选的 members，点 Run Query 执行' : '填入失败：' + r.why);
      });
    });
  }

  function renderResponse(d) {
    if (!d || !d.type) {
      addMsg('err', '响应格式异常：' + esc(JSON.stringify(d).slice(0, 200)));
      return;
    }
    if (d.type === 'answer') {
      renderAnswer(d);
    } else if (d.type === 'ask') {
      var html = esc(d.question || '口径需要确认');
      if (d.options && d.options.length) {
        html += '<div class="ext-chat-opts">';
        d.options.forEach(function (o) {
          html += '<button class="ext-chat-opt">' + esc(o) + '</button>';
        });
        html += '</div>';
      }
      var div = addMsg('ai', html);
      Array.prototype.forEach.call(div.querySelectorAll('.ext-chat-opt'), function (btn) {
        btn.addEventListener('click', function () { submit(btn.textContent); }); // 点击选项即追问
      });
    } else if (d.type === 'nomatch') {
      var gaps = (d.gaps || []).map(esc).join('；');
      addMsg('ai', '<b>语义层未覆盖该问题</b>' + (gaps ? '。缺口：' + gaps : ''));
    } else if (d.type === 'error') {
      addMsg('err', '出错：' + esc(d.error || '未知错误'));
    } else {
      addMsg('ai', esc(JSON.stringify(d).slice(0, 300)));
    }
  }

  /* ---------- 发送 ---------- */

  var pending = false;

  function submit(preset) {
    if (pending) return;
    var q = String(preset != null ? preset : els.input.value).trim();
    if (!q) return;
    if (preset == null) els.input.value = '';
    addMsg('user', esc(q));
    pending = true;
    els.send.disabled = true;
    var loading = addLoading();
    fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, sessionId: SESSION_ID }),
    }).then(function (r) {
      return r.json().then(function (body) {
        return { status: r.status, body: body };
      });
    }).then(function (res) {
      loading.remove();
      pending = false;
      els.send.disabled = false;
      if (res.status !== 200 && (!res.body || !res.body.type)) {
        addMsg('err', 'HTTP ' + res.status + '：' + esc((res.body && res.body.error) || 'chat 服务异常'));
        return;
      }
      renderResponse(res.body);
    }).catch(function (e) {
      loading.remove();
      pending = false;
      els.send.disabled = false;
      addMsg('err', '请求失败：' + esc(e && e.message) + '（chat 服务 localhost:4100 未启动？）');
    });
  }

  /* ---------- 启动：注入 + 自愈 ---------- */

  var attachTimer = null;
  var mo = new MutationObserver(function () {
    clearTimeout(attachTimer);
    attachTimer = setTimeout(attach, 300); // 防抖：React 批量渲染后自愈/升级
  });

  function boot() {
    injectCss();
    attach(); // 首次注入（页面未渲染完时可能 fallback fixed，之后自动升级）
    mo.observe(document.body, { childList: true, subtree: true });
    setInterval(function () {
      if (!els || !els.panel || !els.panel.isConnected ||
          els.panel.classList.contains('ext-chat-fixed')) attach(); // 兜底轮询
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ---------- 调试钩子 ---------- */

  window.__extChat = {
    state: function () {
      return {
        attached: !!(els && els.panel && els.panel.isConnected),
        mode: els && els.panel ? (els.panel.classList.contains('ext-chat-fixed') ? 'fixed' : 'flex') : null,
        inBuild: !!findFlexRow(),
        messages: els && els.msgs ? els.msgs.children.length : 0,
      };
    },
  };
})();
