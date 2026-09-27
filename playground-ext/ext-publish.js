/* ext-publish.js — playground 固化扩展（docs/cube-dataqa-topic/15 §9）
 *
 * v5：固化入口在聊天答案卡（「在构建器中打开」右边，ext-publish 注入 DOM 不动 ext-chat），
 * 每条回答固化自己的查询（query 从消息 data-ext-query 载体取，ext-chat 只读加一行）。
 * v6（17 号 tables 平等契约，2026-09-27）：载体表级化——data-ext-query/data-ext-title
 * 挂到每张表卡片（.ext-chat-tcard）上，本文件逻辑零改动：injectPubBtn 按acts行注入、
 * 点击 closest('[data-ext-query]') 最近祖先即表卡片，点哪张固哪张（多口径每表各一按钮）。
 * Dashboard 导航 tab（坐在 Playground 与 Data Model 之间）面板只剩聚合看板网格
 * （iframe 同源 /embed/all，一行两个看板）。
 * query 原样存档（成员名引用，§8），limit 按图表类型封顶；默认标题优先取表级标题
 * （表卡片 data-ext-title 载体＝tables[].title，15 号 §16 修订），缺失回退 annotation
 * 中文 title 拼接
 * （ext-drill state() 只读口，title 按成员名查、重叠即命中），再回退成员短名。
 * 同源 POST/PUT /cubejs-api/dashboards（embed-patch.js 认领），无鉴权（§7）。
 */
(function () {
  'use strict';
  if (window.__extPublishLoaded) return;
  window.__extPublishLoaded = true;

  var API = '/cubejs-api/dashboards';

  /* ---------- 工具（样式对齐 ext-drill，前缀 ext-pub-） ---------- */

  function injectCss() {
    if (document.getElementById('ext-pub-css')) return;
    var s = document.createElement('style');
    s.id = 'ext-pub-css';
    s.textContent = [
      /* Dashboard 面板：铺 header 以下内容区，header 导航保持可点 */
      '.ext-pub-surface{position:fixed;left:0;right:0;bottom:0;z-index:900;overflow:hidden;',
      '  background:#f5f6f8;padding:16px 24px 20px;display:flex;flex-direction:column;gap:12px;}',
      '.ext-pub-surface .bar{display:flex;align-items:center;gap:12px;flex:none;}',
      '.ext-pub-surface .bar h2{font-size:18px;font-weight:600;margin:0;color:rgba(0,0,0,.88);}',
      '.ext-pub-surface .bar .sp{flex:1;}',
      /* 看板直接渲染：iframe 同源 embed 页，占满剩余高度 */
      '.ext-pub-iframe{flex:1;min-height:0;width:100%;border:none;background:#fff;',
      '  border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.03);}',
      /* 固化对话框（样式对齐 antd，同 ext-drill Modal 先例） */
      '.ext-pub-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);',
      '  display:flex;align-items:center;justify-content:center;}',
      '.ext-pub-panel{background:#fff;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.08),0 9px 28px rgba(0,0,0,.05);',
      "  width:min(520px,94vw);font-size:14px;color:rgba(0,0,0,.88);font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;}",
      '.ext-pub-head{display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid #f0f0f0;}',
      '.ext-pub-head .t{font-weight:600;font-size:16px;}',
      '.ext-pub-close{margin-left:auto;border:none;background:transparent;font-size:18px;cursor:pointer;color:rgba(0,0,0,.45);}',
      '.ext-pub-close:hover{color:rgba(0,0,0,.88);}',
      '.ext-pub-body{padding:14px 20px 4px;}',
      '.ext-pub-row{display:flex;align-items:center;gap:10px;margin-bottom:12px;}',
      '.ext-pub-row label{width:44px;flex:none;color:rgba(0,0,0,.65);}',
      '.ext-pub-row .opts{display:flex;gap:14px;flex-wrap:wrap;align-items:center;}',
      '.ext-pub-row .opts label{width:auto;flex:none;color:inherit;display:inline-flex;align-items:center;gap:4px;margin:0;}',
      '.ext-pub-input,.ext-pub-select{flex:1;border:1px solid #d9d9d9;border-radius:4px;padding:5px 10px;',
      '  font-size:14px;font-family:inherit;min-width:0;}',
      '.ext-pub-input:focus,.ext-pub-select:focus{outline:none;border-color:#1677ff;}',
      '.ext-pub-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 20px 16px;}',
      '.ext-pub-foot button{border-radius:4px;padding:5px 18px;font-size:14px;cursor:pointer;font-family:inherit;}',
      '.ext-pub-foot .ok{border:none;background:#1677ff;color:#fff;}',
      '.ext-pub-foot .ok:hover{background:#4096ff;}',
      '.ext-pub-foot .cancel{border:1px solid #d9d9d9;background:#fff;color:rgba(0,0,0,.65);}',
      '.ext-pub-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:10000;',
      '  background:rgba(0,0,0,.75);color:#fff;border-radius:4px;padding:8px 16px;font-size:13px;cursor:pointer;}',
    ].join('');
    document.head.appendChild(s);
  }

  var toastTimer = null;
  function toast(msg, onClick) {
    var t = document.querySelector('.ext-pub-toast');
    if (!t) { t = document.createElement('div'); t.className = 'ext-pub-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.onclick = onClick || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, onClick ? 8000 : 2600); // 带复制的 toast 停久一点
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('embed 链接已复制'); });
    } else { // 兼容非 https 环境
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('embed 链接已复制'); }
      catch (e) { toast('复制失败，链接：' + text); }
      document.body.removeChild(ta);
    }
  }

  /* 默认标题：annotation 的中文 title（建模确认的口径文字，ext-drill state() 只读口）；
   * annotation 缺失回退成员短名。粒度拼进时间维度：收款日期（按月） */
  var GRAIN = { day: '日', week: '周', month: '月', quarter: '季', year: '年' };
  function shortName(m) { return String(m || '').split('.').pop(); }

  function memberTitle(ann, kind, m) {
    var a = ann && ann[kind] && ann[kind][m];
    return (a && (a.title || a.shortTitle)) || shortName(m);
  }

  function defaultTitle(s) {
    var q = s.query, ann = s.annotation;
    var t = function (kind) { return function (m) { return memberTitle(ann, kind, m); }; };
    var parts = (q.measures || []).map(t('measures'));
    var dims = (q.dimensions || []).map(t('dimensions'));
    (q.timeDimensions || []).forEach(function (td) {
      if (!td || !td.dimension) return;
      var label = memberTitle(ann, 'timeDimensions', td.dimension);
      if (td.granularity && GRAIN[td.granularity]) label += '（按' + GRAIN[td.granularity] + '）';
      dims.push(label);
    });
    return parts.join('、') + (dims.length ? ' 按 ' + dims.join('、') : '');
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /* ---------- Dashboard 导航 tab（坐在 Playground 与 Data Model 之间） ---------- */

  var tabLi = null;

  function findNavUl() {
    // 头部水平菜单：同时含 Playground(/build) 与 Data Model(/schema) 链接的 ul.ant-menu
    var uls = document.querySelectorAll('ul.ant-menu');
    for (var i = 0; i < uls.length; i++) {
      if (uls[i].querySelector('a[href$="/build"]') && uls[i].querySelector('a[href$="/schema"]')) {
        return uls[i];
      }
    }
    return null;
  }

  function injectTab() {
    var ul = findNavUl();
    if (!ul) return;
    var existing = ul.querySelector('li[data-ext-pub-tab]');
    if (existing) { tabLi = existing; return; }
    var buildLi = ul.querySelector('a[href$="/build"]').closest('li');
    if (!buildLi) return;
    tabLi = document.createElement('li');
    tabLi.className = 'ant-menu-item';
    tabLi.setAttribute('data-ext-pub-tab', '1');
    tabLi.setAttribute('role', 'menuitem');
    tabLi.innerHTML = '<a>Dashboards</a>'; // 官方导航锚点样式（未选中灰字）自动继承
    tabLi.addEventListener('click', togglePanel);
    buildLi.after(tabLi); // Playground 之后 = 两者之间
  }

  /* React 重渲染删掉我们的 li 时重插（同 ext-drill MutationObserver 防抖先例） */
  var moTimer = null;
  new MutationObserver(function () {
    clearTimeout(moTimer);
    moTimer = setTimeout(function () {
      try { injectTab(); injectPubBtn(); } catch (e) { /* 任何异常都不影响页面 */ }
    }, 200);
  }).observe(document.body, { childList: true, subtree: true });

  /* ---------- 固化按钮（聊天答案卡，「在构建器中打开」右边） ---------- */

  /* 注入 DOM 不动 ext-chat：按钮复用 ext-chat-act 样式（视觉一致，零自绘 CSS）；
   * query 从消息 data-ext-query 载体取（ext-chat 只读），每条回答固化自己的查询 */
  function injectPubBtn() {
    Array.prototype.forEach.call(document.querySelectorAll('.ext-chat-acts'), function (acts) {
      if (acts.querySelector('[data-ext-pub-btn]')) return;
      var b = document.createElement('button');
      b.className = 'ext-chat-act';
      b.setAttribute('data-ext-pub-btn', '1');
      b.textContent = '固化到看板';
      b.addEventListener('click', function () {
        var msg = b.closest('[data-ext-query]');
        var q = null;
        try { q = JSON.parse(msg.getAttribute('data-ext-query')); } catch (e) { /* 无载体 */ }
        if (!q || !Array.isArray(q.measures) || !q.measures.length) {
          toast('该回答没有可固化的查询');
          return;
        }
        openDialog(q, msg.getAttribute('data-ext-title')); // LLM 一句话标题（§16），缺失回退拼接
      });
      acts.appendChild(b); // acts 行内 builder 按钮之后 = 右边
    });
  }

  /* ---------- Dashboard 面板 ---------- */

  var surface = null;
  var prevSelected = null;

  function togglePanel() { surface ? closePanel() : openPanel(); }

  function openPanel() {
    var ul = findNavUl();
    var header = ul && (ul.closest('header') || ul.parentElement);
    surface = document.createElement('div');
    surface.className = 'ext-pub-surface';
    surface.style.top = (header ? header.getBoundingClientRect().bottom : 56) + 'px';
    surface.innerHTML =
      '<div class="bar"><h2>Dashboards</h2></div>' +
      '<div class="ext-pub-dashbox" style="flex:1;min-height:0;display:flex">' +
      '<div class="loading" style="flex:1;display:flex;align-items:center;justify-content:center;' +
      'color:rgba(0,0,0,.45);background:#fff;border-radius:8px">加载中…</div></div>';
    document.body.appendChild(surface);

    // 选中态：tab 选中，原选中项（Playground）取消
    if (ul) {
      prevSelected = ul.querySelector('li.ant-menu-item-selected');
      if (prevSelected) prevSelected.classList.remove('ant-menu-item-selected');
      // 点其他导航 → 关面板（链接本身照常工作）
      Array.prototype.forEach.call(ul.querySelectorAll('li.ant-menu-item'), function (li) {
        if (li !== tabLi) li.addEventListener('click', closePanel);
      });
    }
    if (tabLi) tabLi.classList.add('ant-menu-item-selected');
    renderAllPanel();
  }

  function closePanel() {
    if (surface && surface.parentNode) surface.parentNode.removeChild(surface);
    surface = null;
    if (tabLi) tabLi.classList.remove('ant-menu-item-selected');
    if (prevSelected) {
      prevSelected.classList.add('ant-menu-item-selected');
      prevSelected = null;
    }
  }

  /* 聚合看板页：所有看板的 widget 一个网格（同参考 Orders Overview 版式），
   * iframe 同源 embed 页——零重复实现，不跳新界面 */
  function renderAllPanel() {
    var box = surface.querySelector('.ext-pub-dashbox');
    if (!box) return;
    box.innerHTML = '';
    var frame = document.createElement('iframe');
    frame.className = 'ext-pub-iframe';
    frame.src = '/embed/all?allowExport=true&showDashboardHeader=false';
    box.appendChild(frame);
  }

  /* ---------- 固化对话框 ---------- */

  var overlay = null;

  function closeDialog() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function radio(name, value, label, checked) {
    return '<label><input type="radio" name="' + name + '" value="' + value + '"' +
      (checked ? ' checked' : '') + '>' + label + '</label>';
  }

  function openDialog(query, nlTitle) {
    var ann = null; // 标题用：ext-drill 捕获的 annotation（title 按成员名查，重叠即命中；缺失回退短名）
    try { ann = window.__extDrill.state().annotation; } catch (e) { /* 无捕获 */ }

    overlay = document.createElement('div');
    overlay.className = 'ext-pub-overlay';
    overlay.innerHTML =
      '<div class="ext-pub-panel">' +
      '<div class="ext-pub-head"><span class="t">固化到看板</span>' +
      '<button class="ext-pub-close">✕</button></div>' +
      '<div class="ext-pub-body">' +
      '<div class="ext-pub-row"><label>标题</label>' +
      '<input class="ext-pub-input" id="ext-pub-wtitle" value="' +
      escAttr(nlTitle || defaultTitle({ query: query, annotation: ann })) + '"></div>' +
      '<div class="ext-pub-row"><label>图表</label><div class="opts">' +
      radio('viz', 'table', '表格', true) + radio('viz', 'bar', '柱状') +
      radio('viz', 'line', '折线') + radio('viz', 'pie', '饼图') +
      radio('viz', 'number', '数值') + '</div></div>' +
      '<div class="ext-pub-row"><label>宽度</label><div class="opts">' +
      radio('width', 'full', '整行', true) + radio('width', 'half', '半行') + '</div></div>' +
      '<div class="ext-pub-row"><label>目标</label><div class="opts">' +
      radio('target', 'new', '新建看板', true) + radio('target', 'append', '追加到') +
      '<select class="ext-pub-select" id="ext-pub-target" style="flex:none;width:220px">' +
      '<option value="">加载看板列表…</option></select></div></div>' +
      '<div class="ext-pub-row" id="ext-pub-new-row"><label>看板名</label>' +
      '<input class="ext-pub-input" id="ext-pub-btitle" value="我的看板"></div>' +
      '</div>' +
      '<div class="ext-pub-foot"><button class="cancel">取消</button>' +
      '<button class="ok">固化</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.ext-pub-close').addEventListener('click', closeDialog);
    overlay.querySelector('.cancel').addEventListener('click', closeDialog);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDialog(); });

    // 目标切换：新建 → 看板名输入框；追加 → 看板下拉
    var targetSel = overlay.querySelector('#ext-pub-target');
    var newRow = overlay.querySelector('#ext-pub-new-row');
    function syncTarget() {
      var append = overlay.querySelector('input[name="target"]:checked').value === 'append';
      targetSel.style.display = append ? '' : 'none';
      newRow.style.display = append ? 'none' : '';
    }
    Array.prototype.forEach.call(overlay.querySelectorAll('input[name="target"]'), function (r) {
      r.addEventListener('change', syncTarget);
    });
    syncTarget();

    fetch(API).then(function (r) { return r.json(); }).then(function (list) {
      if (!overlay) return;
      var byTitle = {}; // 重名时附加 publicId 尾缀区分（§8 字段规则）
      (list || []).forEach(function (d) { byTitle[d.title] = (byTitle[d.title] || 0) + 1; });
      targetSel.innerHTML = (list || []).map(function (d) {
        var label = d.title + (byTitle[d.title] > 1 ? ' · ' + d.publicId : '');
        return '<option value="' + String(d.publicId).replace(/"/g, '&quot;') + '">' +
          String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>';
      }).join('') || '<option value="">（暂无看板）</option>';
    }).catch(function (e) { if (overlay) targetSel.innerHTML = '<option value="">列表加载失败</option>'; });

    overlay.querySelector('.ok').addEventListener('click', function () { doPublish(query); });
  }

  /* ---------- 固化：query 原样存档 + limit 封顶（§8 规则 3，不暴露该值） ---------- */

  function doPublish(query0) {
    var viz = overlay.querySelector('input[name="viz"]:checked').value;
    var width = overlay.querySelector('input[name="width"]:checked').value;
    var target = overlay.querySelector('input[name="target"]:checked').value;
    var wtitle = overlay.querySelector('#ext-pub-wtitle').value.trim();
    var query = JSON.parse(JSON.stringify(query0)); // 原样存档（成员名引用，§8 规则 1）
    delete query.rowLimit; // 捕获自网关响应回显，请求侧网关拒绝 rowLimit（ext-drill 实测先例）
    query.limit = viz === 'table' ? 1000 : (viz === 'number' ? 10 : 100); // 封顶：表格 1000 / 图表 100 / 数值 10
    var widget = { title: wtitle, viz: viz, layout: { width: width }, query: query };

    var url, body;
    if (target === 'append') {
      var publicId = overlay.querySelector('#ext-pub-target').value;
      if (!publicId) { toast('请选择要追加的看板'); return; }
      url = API + '/' + publicId;
      body = { widget: widget };
    } else {
      var btitle = overlay.querySelector('#ext-pub-btitle').value.trim();
      if (!btitle) { toast('请填写看板名'); return; }
      url = API;
      body = { title: btitle, widget: widget };
    }

    var okBtn = overlay.querySelector('.ok');
    okBtn.disabled = true;
    okBtn.textContent = '固化中…';
    fetch(url, {
      method: target === 'append' ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' }, // 同源无鉴权（§7），secret 不进页面
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) {
        throw new Error('固化失败 HTTP ' + res.status + ': ' + t.slice(0, 200));
      });
      return res.json();
    }).then(function (out) {
      closeDialog();
      var link = location.origin + '/embed/dashboard/' + out.publicId;
      toast('已固化 ' + out.publicId + '，点击复制 embed 链接', function () { copyText(link); });
      if (surface) renderAllPanel(); // 面板开着时刷新聚合页（带进新 widget）
    }).catch(function (e) {
      toast(e.message);
      okBtn.disabled = false;
      okBtn.textContent = '固化';
    });
  }

  injectCss();
  injectTab();
})();
