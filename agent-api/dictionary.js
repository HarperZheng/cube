'use strict';
/**
 * GET/POST /agent/dictionary——27 文档 §6.1 词典配合：口径拍板服务端化。
 * 存档 conf/agent/dictionary.json（schema agent-dictionary/1，含
 * legacy 词条：指向 2026-10 模型重建前的 cube，仅历史参考）。
 *
 * GET  ?term= 按词查（精确优先，无则含子串）；无参返回整册（几十条可整包）。
 * POST 拍板回写：upsert by term，新词条 legacy=false（当前模型）；
 *      POST 为写操作 → index.js 授权表单列 write scope。
 * 维护规则（tools.js 同步透出）：只能映射到 meta.ai_context / 成员
 * description 已提供的选项，不能发明成员；与 ai_context 冲突以
 * ai_context 为准并更新词条。
 */

const fs = require('fs');
const path = require('path');

const DICT_PATH = process.env.AGENT_API_DICT_PATH || '/cube/conf/agent/dictionary.json';

function readDict() {
  try {
    return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { schema: 'agent-dictionary/1', note: '', entries: [] };
    throw { httpStatus: 500, error: 'dictionary_unreadable', message: `词典读取失败: ${e.message}` };
  }
}

function atomicWrite(obj) {
  fs.mkdirSync(path.dirname(DICT_PATH), { recursive: true });
  const tmp = `${DICT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, DICT_PATH);
}

async function get(params, ctx) {
  const dict = readDict();
  const term = ctx.searchParams.get('term');
  if (!term) return dict;
  const exact = dict.entries.filter((e) => e.term === term);
  const hit = exact.length ? exact : dict.entries.filter((e) => e.term.includes(term));
  return { schema: dict.schema, note: dict.note, term, entries: hit };
}

async function post(params, ctx) {
  const b = ctx.body || {};
  for (const f of ['term', 'cube', 'rule']) {
    if (!b[f] || typeof b[f] !== 'string') {
      throw { httpStatus: 400, error: 'invalid_entry', message: `POST /agent/dictionary 需要 {term, cube, rule} 字符串字段，缺 "${f}"（alternatives/decidedAt/background 可选）` };
    }
  }
  const dict = readDict();
  const entry = {
    term: b.term.trim(),
    cube: b.cube.trim(),
    rule: b.rule,
    alternatives: b.alternatives || '',
    decidedAt: b.decidedAt || new Date().toISOString().slice(0, 10),
    background: b.background || '',
    legacy: false, // 新拍板默认针对当前模型；legacy:true 词条由人工维护（历史参考）
  };
  const i = dict.entries.findIndex((e) => e.term === entry.term);
  let action = 'created';
  if (i >= 0) { dict.entries[i] = entry; action = 'updated'; } else { dict.entries.push(entry); }
  atomicWrite(dict);
  return { ok: true, action, entry, total: dict.entries.length };
}

module.exports = { get, post };
