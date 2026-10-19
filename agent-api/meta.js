'use strict';
/**
 * GET /agent/meta（目录面）与 GET /agent/meta/:cube（成员全集）——27 文档 §6.1。
 *
 * 直读挂载卷 conf/model 下全部 yml，不混用原生 /cubejs-api/v1/meta——conf
 * 即唯一真相源，避免双源漂移。目录面全量 2–5KB 可整包进 LLM 上下文；
 * 成员面透出 ai_context / includes / folders（框架侧无文件访问，口径
 * 唯一真相经此端点透出）。
 *
 * 缓存：yml 路径+mtime+size 指纹 → 命中复用解析结果；缓存放 globalThis
 * 而非模块作用域——index.js 每请求失效本模块缓存，指纹缓存不能陪葬。
 */

const fs = require('fs');
const path = require('path');

const MODEL_ROOT = process.env.AGENT_API_MODEL_ROOT || '/cube/conf/model';

function loadYaml() {
  const candidates = ['js-yaml', '/cube/node_modules/@cubejs-backend/schema-compiler/node_modules/js-yaml'];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 下一个 */ }
  }
  throw new Error('js-yaml 不可用（根与 schema-compiler 内都未找到）');
}
const yaml = loadYaml();

function walkYml(dir, out) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; } // 目录不存在 → 空模型
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walkYml(p, out);
    else if (/\.ya?ml$/i.test(it.name)) out.push(p);
  }
}

function loadModel() {
  const files = [];
  walkYml(MODEL_ROOT, files);
  const fp = files.map((f) => {
    const st = fs.statSync(f);
    return `${f}:${st.mtimeMs}:${st.size}`;
  }).join('|');
  const hit = globalThis.__agentApiModelCache;
  if (hit && hit.fp === fp) return hit.model;

  const model = { cubes: {}, views: {}, errors: [] };
  for (const f of files) {
    try {
      const doc = yaml.load(fs.readFileSync(f, 'utf8'));
      for (const c of (doc && doc.cubes) || []) if (c && c.name) model.cubes[c.name] = c;
      for (const v of (doc && doc.views) || []) if (v && v.name) model.views[v.name] = v;
    } catch (e) {
      model.errors.push({ file: path.relative(MODEL_ROOT, f), message: e.message });
    }
  }
  globalThis.__agentApiModelCache = { fp, model };
  return model;
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// 目录面：views 优先（交付面是消费入口），cubes 随后；只挑轻字段
async function catalog() {
  const m = loadModel();
  const topics = [];
  for (const v of Object.values(m.views)) {
    topics.push({
      name: v.name, type: 'view', title: v.title || '',
      description: trunc(v.description, 160),
      ai_context_summary: trunc((v.meta && v.meta.ai_context) || '', 100),
    });
  }
  for (const c of Object.values(m.cubes)) {
    topics.push({
      name: c.name, type: 'cube', title: c.title || '',
      description: trunc(c.description, 160),
      ai_context_summary: trunc((c.meta && c.meta.ai_context) || '', 100),
      public: c.public !== false,
    });
  }
  return {
    schema: 'agent-meta-catalog/1',
    generatedAt: new Date().toISOString(),
    counts: { views: Object.keys(m.views).length, cubes: Object.keys(m.cubes).length },
    ...(m.errors.length ? { parseErrors: m.errors } : {}),
    topics,
  };
}

// 成员面：view = includes 展开（viewName.memberName，fromCube=join_path，
// excludes 显式剔除）；cube = public!==false 全集 + accessPolicy 标记
async function members(params) {
  const name = params[0];
  const m = loadModel();

  const v = m.views[name];
  if (v) return viewMembers(v, m);

  const c = m.cubes[name];
  if (c) return cubeMembers(c);

  throw { httpStatus: 404, error: 'not_found', message: `主题 "${name}" 不在 conf/model 中（既非 view 也非 cube），可用主题见 GET /agent/meta` };
}

function viewMembers(v, m) {
  const measures = [];
  const dimensions = [];
  const missingCubes = [];

  for (const part of v.cubes || []) {
    const joinPath = typeof part === 'string' ? part : (part.join_path || '');
    const includes = (typeof part === 'string' ? [] : (part.includes || []));
    const excludes = new Set(typeof part === 'string' ? [] : (part.excludes || []));
    if (!joinPath || !includes.length) continue;

    // join_path 支持链式（a.b）；本项目 view 均单段，链式时按末段解析
    const cubeName = m.cubes[joinPath] ? joinPath : joinPath.split('.').pop();
    const cube = m.cubes[cubeName];
    if (!cube) { missingCubes.push(joinPath); continue; }

    const all = [...(cube.measures || []), ...(cube.dimensions || [])];
    for (const inc of includes) {
      if (excludes.has(inc)) continue;
      const mem = all.find((x) => x && x.name === inc);
      if (!mem) continue; // includes 指向不存在成员（yml 笔误）→ 跳过不炸接口
      const isMeasure = (cube.measures || []).includes(mem);
      const entry = {
        name: `${v.name}.${inc}`,
        fromCube: joinPath,
        type: isMeasure ? 'measure' : 'dimension',
        title: mem.title || '',
        description: mem.description || '',
      };
      if (mem.meta && mem.meta.ai_context) entry.ai_context = mem.meta.ai_context;
      (isMeasure ? measures : dimensions).push(entry);
    }
  }

  // view 自带成员（直接定义在 view 上的，少数场景）
  for (const mem of v.measures || []) {
    if (mem && mem.name && mem.public !== false) measures.push({ name: `${v.name}.${mem.name}`, fromCube: null, type: 'measure', title: mem.title || '', description: mem.description || '' });
  }
  for (const mem of v.dimensions || []) {
    if (mem && mem.name && mem.public !== false) dimensions.push({ name: `${v.name}.${mem.name}`, fromCube: null, type: 'dimension', title: mem.title || '', description: mem.description || '' });
  }

  return {
    schema: 'agent-meta-members/1',
    name: v.name, type: 'view',
    title: v.title || '', description: v.description || '',
    ai_context: (v.meta && v.meta.ai_context) || '',
    folders: (v.folders || []).map((f) => ({ name: f.name, includes: f.includes || [] })),
    measures, dimensions,
    ...(missingCubes.length ? { warnings: [`includes 引用的 cube 不存在: ${missingCubes.join(', ')}`] } : {}),
  };
}

function cubeMembers(c) {
  // accessPolicy 标记：出现在任意 access_policy 规则成员清单中的成员
  const flagged = new Set();
  for (const rule of c.access_policy || []) {
    for (const n of (rule && (rule.memberNames || rule.members)) || []) flagged.add(n);
  }
  const map = (list, type) => (list || [])
    .filter((x) => x && x.name && x.public !== false)
    .map((x) => {
      const e = {
        name: `${c.name}.${x.name}`, type,
        title: x.title || '', description: x.description || '',
      };
      if (x.meta && x.meta.ai_context) e.ai_context = x.meta.ai_context;
      if (flagged.has(x.name)) e.accessPolicy = true;
      return e;
    });

  return {
    schema: 'agent-meta-members/1',
    name: c.name, type: 'cube',
    title: c.title || '', description: c.description || '',
    public: c.public !== false,
    ai_context: (c.meta && c.meta.ai_context) || '',
    joins: (c.joins || []).map((j) => ({ name: j.name, relationship: j.relationship })),
    measures: map(c.measures, 'measure'),
    dimensions: map(c.dimensions, 'dimension'),
  };
}

module.exports = { catalog, members };
