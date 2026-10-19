// agent chat 测试薄壳：claude Agent SDK 驱动（27 号方案测试期替代件）
// 契约：POST /chat {question, sessionId} → 200 + 三态 JSON（answer/ask/nomatch）原样透传
// 分层纪律：问数知识零存在——编排循环在 SDK 引擎，表达契约在 SKILL.md，数据真相在 :4000 /agent/*
// AgentScope（27-agent-chat 方案）就绪后整目录删除，窗口 CHAT_URL 改指 :8087
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = path.join(ROOT, 'chat', 'claude-ask-settings.json');
const PORT = Number(process.env.AGENT_SVC_PORT || 4100);
const TIMEOUT_MS = Number(process.env.AGENT_SVC_TIMEOUT_MS || 600000);

// 日志落盘：logs/agent-svc-YYYY-MM-DD.log，bridge 同款格式与粒度（全程留痕）：
// 收到问题 → spawn → init → thinking/tool_use/tool_result/text 逐块全文（│ 前缀逐行）→ result → 响应已送
const LOG_DIR = path.join(ROOT, 'logs');
const _log = console.log.bind(console), _err = console.error.bind(console);
function emit(line, isErr) {
  (isErr ? _err : _log)(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fs.appendFileSync(path.join(LOG_DIR, `agent-svc-${day}.log`), line + '\n');
  } catch { /* 日志失败不碍服务 */ }
}
function ts() { // bridge 同款 ISO 本地时戳：2026-10-12T14:33:20.094+08:00
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + off * 60000);
  return `${local.toISOString().slice(0, 23)}${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
}
function logf(level, tag, msg) { emit(`${ts()} ${level.padEnd(5)} [${tag}] ${msg}`, level === 'ERROR'); }
function logBlock(tag, head, body) { // 多行内容逐行 │ 前缀（bridge 同款）
  logf('INFO', tag, head);
  for (const line of String(body ?? '').split('\n')) logf('INFO', tag, `│ ${line}`);
}

// 本机分叉点（memory）：HKLM 的 CLAUDE_CODE_GIT_BASH_PATH 指到 git-bash.exe（GUI 启动器，
// 无效）会让引擎回退 PowerShell 工具——继承来的值不可信，**覆盖**（setdefault 不行）为 shell 本体
{
  const candidate = 'D:\\develop\\Git\\bin\\bash.exe';
  if (fs.existsSync(candidate)) process.env.CLAUDE_CODE_GIT_BASH_PATH = candidate;
}

// 首轮指令：仅输出形态兜底，流程与判定一律以 SKILL.md 为准（双重解析=弯路，19 号 §2#1）
const FIRST_INSTRUCTION = `用 cube-ask skill 处理下面的用户问题，执行其契约（主链四步 + 条件步）。
约束（仅输出形态兜底）：
1. 收到本 prompt 后第一个动作必须是调用 Skill(cube-ask)。
2. 歧义时不要用 AskUserQuestion 工具（本环境无交互 UI）——输出 {"type":"ask","question":"...","options":["..."]}
3. 确实查不了时输出 {"type":"nomatch","question":"...","gaps":["..."]}
4. 无论任何情况，最终只输出一个三态 JSON 对象（不要 markdown 围栏、不要任何解释文字）。

用户问题：
`;

const sessions = new Map(); // 窗口 sessionId → claude session_id

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('请求体超 2MB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', // 窗口在 :4000 源，本机 demo 放开
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

async function runAgent(question, claudeSid) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let sid = claudeSid, text = null;
  logf('INFO', 'claude', `spawn resume=${!!claudeSid}`); // SDK 内部起引擎进程，pid 不可见
  try {
    const q = query({
      prompt: claudeSid ? question : FIRST_INSTRUCTION + question,
      options: {
        cwd: ROOT,
        permissionMode: 'bypassPermissions',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Skill'],
        effort: 'low',            // GLM 思考压缩杠杆（同款重题 473s→77s 实测）
        settings: SETTINGS,       // deny 写护栏（bypass 下仍生效）
        maxTurns: 40,
        ...(claudeSid ? { resume: claudeSid } : {}),
        abortController: ac,
      },
    });
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sid = msg.session_id || sid;
        logf('INFO', 'agent', `init model=${msg.model} claude_sid=${sid} tools=${(msg.tools || []).length}`);
      } else if (msg.type === 'assistant') {
        for (const b of msg.message?.content || []) {
          if (b.type === 'thinking') {
            logBlock('agent', `thinking ── ${(b.thinking || '').length} 字符`, b.thinking);
          } else if (b.type === 'tool_use') {
            logBlock('agent', `tool_use ${b.name} ── ${JSON.stringify(b.input || {}).length} 字符`, JSON.stringify(b.input || {}));
          } else if (b.type === 'text' && b.text) {
            logBlock('agent', `text ── ${b.text.length} 字符`, b.text);
          }
        }
      } else if (msg.type === 'user') {
        const content = msg.message?.content;
        for (const b of (Array.isArray(content) ? content : [])) {
          if (b.type === 'tool_result') {
            const c = typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
                ? b.content.map((x) => x.text ?? JSON.stringify(x)).join('\n')
                : JSON.stringify(b.content);
            logBlock('agent', `tool_result ── ${(c || '').length} 字符${b.is_error ? ' (is_error)' : ''}`, c);
          }
        }
      } else if (msg.type === 'result') {
        text = msg.result || '';
        sid = msg.session_id || sid;
        logf('INFO', 'agent', `result subtype=${msg.subtype} turns=${msg.num_turns} 耗时 ${(msg.duration_ms / 1000).toFixed(1)}s`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { sid, text };
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const question = body && body.question;
  if (!question || typeof question !== 'string') {
    logf('WARN', 'svc', '收到非法请求体（question 缺失）');
    return sendJson(res, 400, { error: 'question 必填（{question, sessionId?}）' });
  }
  const wsid = (body.sessionId && String(body.sessionId)) || 'default';
  const claudeSid = sessions.get(wsid);
  logf('INFO', 'svc', `收到问题 sessionId=${wsid} "${question}"`);

  let out;
  try {
    out = await runAgent(question, claudeSid);
  } catch (e) {
    const msg = String((e && e.message) || e);
    logf('ERROR', 'claude', `调用失败: ${msg.slice(0, 300)}`);
    logf('ERROR', 'svc', `问答失败: claude 调用失败: ${msg.slice(0, 300)}`);
    return sendJson(res, 502, { error: `agent 调用失败: ${msg.slice(0, 300)}` });
  }
  if (!out.text) {
    logf('ERROR', 'svc', '问答失败: agent 无结果返回');
    return sendJson(res, 502, { error: 'agent 无结果返回' });
  }
  sessions.set(wsid, out.sid);

  let payload;
  try { payload = JSON.parse(out.text); }
  catch {
    logf('ERROR', 'svc', `问答失败: 输出不是合法 JSON，原文前 400 字符：${out.text.slice(0, 400)}`);
    return sendJson(res, 502, { error: out.text.slice(0, 400) });
  }
  logf('INFO', 'svc', `响应已送 ${payload.type} sessionId=${wsid}`);
  sendJson(res, 200, payload);
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
    return sendJson(res, 200, { ok: true, service: 'agent-svc', sessions: sessions.size });
  }
  if (req.method === 'POST' && pathname === '/chat') {
    handleChat(req, res).catch((e) => sendJson(res, 500, { error: String((e && e.message) || e) }));
    return;
  }
  sendJson(res, 404, { error: 'not found（POST /chat）' });
});

server.listen(PORT, () => {
  logf('INFO', 'svc', `listening on :${PORT}（POST /chat；cwd=${ROOT}）`);
  logf('INFO', 'svc', `deny settings: ${SETTINGS}`);
  logf('INFO', 'svc', `git-bash: ${process.env.CLAUDE_CODE_GIT_BASH_PATH || '⚠️ 未设，Bash 工具可能回退 PowerShell'}`);
});
