# -*- coding: utf-8 -*-
"""chat_server.py —— Cube AI Agent v2 桥（HTTP ⇄ claude 会话）

v2（docs/cube-dataqa-topic/11-chat-agent开发计划-v2.md）：后台 = 独立 claude 全代理，
claude 通过 cube-ask skill 原生问数契约（主链四步+条件步）与 Cube 语义层互通；本文件瘦身为桥——
v1 五步管线（_pipeline/_missing_members/_assembled_query/pending 历史）已删除，
保留 HTTP/CORS/会话锁 + ask/nomatch/error 补审计（v1 12 节逻辑收编）。

D3（11 号文档 §10）：首轮 prompt 预置上下文（①模型摘要 ②通道配方 ③口径词典，
_preset_context 每问现扫零缓存）+ 会话重建（层2 空闲 SESSION_TTL / 层3 链轮数
SESSION_MAX_TURNS，触发即丢 claude_sid 按首轮重注，WARN 留痕）。

日志（docs/cube-dataqa-topic/14-日志规格.md，R3）：
  结果层：logs/qa-log.jsonl（自 regress/ 迁移，审计主链路，R3 桥单写——answer 行由
          _qa_log_answer 从最终三态 JSON 机械派生，agent 零写日志；ask/nomatch/error
          行 _qa_log_outcome 补审计）
  推理层：logs/agent/（R2 扁平化，无 sessionId 子目录）——spawn 的 stream-json
          事件流（官方格式原样）+ index.jsonl（串 resume/重建链条，行内带 sessionId）
  运维层：logs/bridge-YYYY-MM-DD.log（R2 §4.6，按日）——<ISO+08:00> <LEVEL> [组件] 消息，
          [bridge]/[claude]/[agent]；Popen 增量读逐行打点，tail -f 实时看问数过程

POST /chat  {question, sessionId} → 三态响应（桥透传 claude 输出）：
  {"type":"answer", title, plan, tables, answer, assumption, truncated, rows, hitPreAgg, audited}
  （audited = 高风险对数通过标记，前端 foot 徽标「已与 Oracle 对数一致」；未对数 false/省略）
  （tables = 口径平等的表数组，每表 {title, query, rows, total}——17 号文档 tables 平等契约：
   答案需要几个口径就几张表，data/答案级 query 字段已删除，占比分母 = 表级 total；
   title = 概括整个答案的一句话自然语言标题，固化看板默认标题用表级 tables[].title）
  {"type":"ask",    question, options}
  {"type":"nomatch", question, gaps}

通信形态（v2 文档 §5.1，subprocess 进程调用，非网络 API）：
  首轮：claude -p "<CLAUDE_INSTRUCTION + 问题>" --output-format stream-json --verbose
  续轮：claude -p "<用户回复>" --resume <session_id> --output-format stream-json --verbose
  返回：result 行 {"result": "<最终文本>", "session_id": "<uuid>"}（单对象 json 模式超集）
"""
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# D3 预置上下文（§10.3）①模型摘要需要 PyYAML——宿主机已装（6.0.1 实测）；
# 缺失时①块降级为提示语（agent 按 skill 第1步读模型文件），不阻塞问答
try:
    import yaml
except ImportError:   # pragma: no cover
    yaml = None
import glob

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根（skill 加载 cwd）
QA_LOG_PATH = os.environ.get('QA_LOG_PATH', os.path.join(PROJECT_DIR, 'logs', 'qa-log.jsonl'))
LOG_DIR = os.path.join(PROJECT_DIR, 'logs', 'agent')   # 14 号 R2：推理层 logs/agent/（平铺）
PORT = int(os.environ.get('CHAT_PORT', '4100'))
CLAUDE_TIMEOUT = int(os.environ.get('CLAUDE_TIMEOUT', '600'))   # 秒；claude 问数主链预期 60-180s，
# 重问（多口径 plan）实测可到 300s+（09-24 模糊问五步完成后差 18s 被杀）——600 保重问跑完

# D3 会话重建（§10.4 层2/层3，同一路径：丢 claude_sid 按首轮重注预置上下文）：
# 层2 空闲超时（默认 30 分钟）；层3 resume 链累计轮数上限（默认 20——41 轮链实测单轮
# thinking 间隔 5-16s→21-46s，14:29 零 Read 仍 114.7s，膨胀代价大于重建代价）
SESSION_TTL = int(os.environ.get('SESSION_TTL', '1800'))
SESSION_MAX_TURNS = int(os.environ.get('SESSION_MAX_TURNS', '20'))

# 桥给 claude 的首轮指令（v2 文档 §5.2 + D3 §10.3）：skill 点名 + 三态 JSON 约束 +
# AskUserQuestion 禁用 + 预置上下文跳过声明（末尾接【预置上下文】块与问题，见 _first_prompt）
CLAUDE_INSTRUCTION = """用 cube-ask skill 处理下面的用户问题，执行其契约（主链：语义解析 → 组装 → cube.js query → 答案纪律；条件步：执行报错才 meta 核验诊断，高风险才 db.js 对数）。
约束：
1. 歧义时不要用 AskUserQuestion（本环境无交互 UI）——输出 {"type":"ask","question":"...","options":["...","..."]}
2. 确实查不了时输出 {"type":"nomatch","question":"...","gaps":["..."]}
3. 回答时输出 {"type":"answer","title":"一句话标题","plan":[["自然语言","cube.member","依据"]],"tables":[{"title":"表标题","query":{"measures":[],"dimensions":[],"filters":[],"timeDimensions":[],"order":{},"limit":100},"rows":[],"total":null}],"answer":"口径声明+拍板结论+数据范围","assumption":"...","truncated":false,"rows":0,"hitPreAgg":null,"audited":false}
   tables = 口径平等的表数组：答案需要几个口径就几张表，
   单口径 1 张，没有主次之分。每表四个字段——
   title：表级标题，写清口径身份（如「口径A：单位×项目（收入日结）」）；
   query：该表可执行的完整 query；
   rows：该表查询返回的扁平行数组，每行 = cube 成员名→值的扁平键值对（一行一对象），
   禁止 {scope, rows} 等嵌套包装；
   total：该表占比分母，用不带 dimensions 的全量查询拿（禁把截断行加总当总数），
   无分母语义置 null。禁止跨口径合计——占比只在表内算，每表独立 total
   并列总数合并：仅当同主语并列子问（一句话几个同级小问题，各要一个
   总数，如"今天新增开具/已缴/入国库各多少笔"）且各口径都是单行聚合（无 dimensions，
   各返回一行一个数）时——tables 只返回一张合并表：rows 拼成一行，键=各口径度量
   成员名（列名=成员名末段，接受原列名）；query=首条口径的完整 query（构建器/固化
   用；跨 cube 多度量拼一条是无效 query，禁止）；title 概括全部口径（含各自时间轴）；
   total 置 null（跨口径无分母）。什么不合：任一子问带 dimensions（多行明细）、
   子问间非并列、混合（有的总数有的分组）→ 各表各的，平等渲染；同一 cube
   多个度量一条 query 出多列，不属此分叉。
   answer 只写口径声明、歧义拍板结论、数据范围、截断说明——表格数据不进文本（前端只渲染 tables）
   title = 概括整个答案的一句话自然语言标题（≤30 字），含口径关键语义（如 filters
   决定的「已核销」），不要列名堆砌（例：「各单位票据核销情况（已核销份数）」）；
   多口径时覆盖全部口径、不跟任何单表——固化看板默认标题用表级 tables[].title
   rows = 全部表行数之和；truncated = 任一表可能截断（行数==limit）即 true
   audited = 高风险对数（skill 第5步：金额度量/对外汇报/写入文档）通过时 true，
   前端 foot 徽标展示「已与 Oracle 对数一致」；未做对数置 false 或省略
   hitPreAgg = 读 query 输出的命中自报行判定——cube.js query 每笔查询后必打
   [预聚合命中] xxx / [未命中预聚合] 走源库 行：见 [预聚合命中] 置 true，
   见 [未命中预聚合] 置 false；多笔查询任一命中即 true；无查询场景保持 null
4. 无论任何情况，最终只输出一个上述三态 JSON 对象（不要 markdown 围栏、不要任何解释文字）
5. 问数日志（logs/qa-log.jsonl）由桥从你最终输出的 JSON 机械派生——不要自己追加、
   不要为日志构造任何内容；保证约束 3 的契约字段（plan/tables[].query/assumption/
   truncated/rows）齐全即可
6. 本 prompt 附有【预置上下文】（模型摘要/查询通道/口径词典，机械提取自模型文件原文）：
   跳过读模型文件（conf/model/**）与口径词典，直接进语义解析产出计划表；
   查询通道凭据已预填，禁止读 .env / docker-compose.yml
7. 预置摘要与 meta 核验输出冲突时，以 meta 为准（meta 是编译事实，摘要只是搬运）——
   成员在 meta 里有而摘要里没有时照查；meta 核验仅执行报错时进（skill 第4步
   重入 gate：修正后计划须 meta 通过才重查），query 正常返回不跑；
   高风险（金额度量/对外汇报/写入文档）才做第5步 db.js 对数，通过时 answer 加 "audited":true
8. 多笔查询（并列子问/多口径）合并为一次 Bash 调用：逐笔落盘
   regress/tmp-query-1.json、tmp-query-2.json … 后一次容器内循环跑完、跑完即删——
   每次 Bash 调用有 ~5s 管道税（进程创建+输出捕获），N 笔单发多花 (N-1)×5s 且多
   1-2 轮思考：
   docker exec cube sh -c 'for f in /cube/regress/tmp-query-*.json; do echo "== $f =="; node /cube/agent/cube.js query -f "$f"; done; rm -f /cube/regress/tmp-query-*.json'
   单笔查询仍走 ②查询通道的单文件形态；失败重查：重写对应 tmp 文件再跑同一循环
   （glob 只命中现存文件，不误跑已删笔）

【预置上下文】
"""

# 权限实测（D0）：工具名 allowlist（--allowedTools "Bash Read ..."）在 -p 下只放行
# Read/Grep 等只读工具，Bash 的命令级权限仍走 sandbox 审批（headless 无法批准 → docker
# exec 全拦，语义解析完整但执行通道全阻）。可靠通道是 --permission-mode
# bypassPermissions：冒烟 docker exec 真正执行、permission_denials=[]、全程 6s。
# 本地单用户 demo 边界（v2 文档 §2）下采用；CLAUDE_TOOLS 保留作 allowlist 意图声明，
# bypass 被拒时兜底只读工具仍可用。
CLAUDE_TOOLS = 'Bash Read Write Edit Grep Glob Skill'

_SESSIONS = {}   # chat sessionId -> {"claude_sid", "turns"(链累计), "last_active"}
_LOCK = threading.Lock()


def _one_line(v):
    """yml 多行标量（| / >-）压成单行——机械搬运，不改写内容（§10.3 原则）。"""
    return ' '.join(str(v).split())


def _member_ref(x):
    """includes/excludes 条目 → 显示名。bool 是 YAML 1.1 未加引号 yes/no/true/false
    的解析结果（实测 writeoff_view.yml includes '- no' → False，2026-09-24 发现，
    建模侧 quirk 转 cube-modeling）——机械标注，防 agent 按字面 'False' 找成员。"""
    if isinstance(x, bool):
        return '%s（⚠️ yml 未加引号被 YAML 解析为布尔，原意可能是成员名 yes/no）' % x
    return str(x)


def _extract_model_block():
    """① 模型摘要（§10.3）：现扫 views/*.yml + cubes/*.yml + cubes/*/*.yml，
    机械提取 title / 成员名 / description / ai_context / 交付面 includes——100% 来自
    yml 原文，不摘要不改写（"成员语义唯一真相是模型文件"不破）。

    views 先（skill 第1步：先 view 后 cube）、cubes 后；成员标 (非public) 的
    meta 核验不出现（失败模式 b：技术键不该查），列出让 agent 免回读 yml 即可
    区分"没建模"与"藏了不查"。PyYAML 缺失/单文件解析失败降级为提示语，不阻塞。
    """
    if yaml is None:
        return '（PyYAML 不可用，模型摘要未生成——请按 skill 第1步读模型文件）'
    lines = []
    model_dir = os.path.join(PROJECT_DIR, 'conf', 'model')
    file_groups = [('view', sorted(glob.glob(os.path.join(model_dir, 'views', '*.yml')))),
                   ('cube', sorted(glob.glob(os.path.join(model_dir, 'cubes', '*.yml')))
                    + sorted(glob.glob(os.path.join(model_dir, 'cubes', '*', '*.yml'))))]
    for kind, paths in file_groups:
        for path in paths:
            rel = os.path.relpath(path, PROJECT_DIR).replace('\\', '/')
            try:
                with open(path, encoding='utf-8') as fh:
                    doc = yaml.safe_load(fh)
            except (OSError, yaml.YAMLError) as e:
                lines.append('=== %s 读取/解析失败: %s' % (rel, e))
                continue
            if not isinstance(doc, dict):
                continue
            items = doc.get('views') if kind == 'view' else doc.get('cubes')
            for item in items or []:
                if not isinstance(item, dict):
                    continue
                name = item.get('name') or '?'
                title = item.get('title') or ''
                lines.append('=== %s %s%s（定义: %s）' % (
                    kind, name, ('「%s」' % title) if title else '', rel))
                if item.get('description'):
                    lines.append('  说明: ' + _one_line(item['description']))
                ai_ctx = (item.get('meta') or {}).get('ai_context')
                if ai_ctx:
                    lines.append('  ai_context: ' + _one_line(ai_ctx))
                if kind == 'view':
                    for c in item.get('cubes') or []:
                        if not isinstance(c, dict):
                            continue
                        inc = c.get('includes') or []
                        exc = c.get('excludes') or []
                        lines.append('  交付面 join_path=%s includes[%d]: %s' % (
                            c.get('join_path') or '?', len(inc),
                            ', '.join(_member_ref(x) for x in inc)))
                        if exc:
                            lines.append('    excludes: %s'
                                         % ', '.join(_member_ref(x) for x in exc))
                else:
                    for sec, label in (('measures', '度量'), ('dimensions', '维度')):
                        for m in item.get(sec) or []:
                            if not isinstance(m, dict):
                                continue
                            line = '  %s %s%s' % (label, m.get('name') or '?',
                                                  ('「%s」' % m['title']) if m.get('title') else '')
                            if m.get('description'):
                                line += ': ' + _one_line(m['description'])
                            mai = (m.get('meta') or {}).get('ai_context')
                            if mai:
                                line += ' ｜ ai_context: ' + _one_line(mai)
                            if m.get('public') is False:
                                line += '（非public，meta 核验不出现，勿查）'
                            lines.append(line)
    return '\n'.join(lines)


def _extract_channel_block():
    """② 通道配方（§10.3）：docker exec cube.js 主通道（skill 同款）+ curl REST
    备选（宿主机 bash，Authorization 预填——.env 现读，单一来源仍是 .env）。
    预填动机（§10.1）：嵌套引号难写对曾把 agent 逼出 skill 规定的通道自己找 REST，
    烧掉读 .env/docker-compose/构造 header 三轮，预填后这三轮消失。
    两条铁律：禁止裸 body（网关只取 body.query → "Query param is required"，
    agent 自愈 ~26s 且会话重建后重摔）；禁止内联中文 body（git-bash curl 走 GBK
    必 500）——中文 body 落盘 UTF-8 文件再 -d @file。secret 解析失败降级为提示语
    （agent 回读 .env），不阻塞。
    """
    secret = ''
    try:
        with open(os.path.join(PROJECT_DIR, '.env'), encoding='utf-8') as fh:
            for ln in fh:
                ln = ln.strip()
                if ln.startswith('CUBEJS_API_SECRET='):
                    secret = ln.split('=', 1)[1].strip()
                    break
    except OSError:
        pass
    port = os.environ.get('CUBEJS_API_PORT', '4000')   # compose ports 4000:4000
    if secret:
        auth = secret
    else:   # .env 缺失/无 secret——降级提示，agent 自行读取（轮次兜底）
        auth = '<读 .env 的 CUBEJS_API_SECRET>'
    return """docker exec 主通道（skill 同款，容器内跑，宿主机零 Node 依赖）：
  第0步 check：docker exec cube sh -c "node /cube/agent/cube.js check"
  meta（第4步失败诊断用）：docker exec cube sh -c "node /cube/agent/cube.js meta <cube名>"
  query（第3步执行）：docker exec cube sh -c "node /cube/agent/cube.js query '<json>'"
    （JSON 内 " 转义 \\"；复杂 query 落盘 regress/tmp-query.json →
    docker exec cube sh -c "node /cube/agent/cube.js query -f /cube/regress/tmp-query.json"，用后即删）
  对数（第5步，高风险才做）：docker exec cube sh -c "node /cube/agent/db.js sql '<sql>'"（sh 单引号内字面量写成 '\\''值'\\''，漏转义典型症状 ORA-01722）
curl REST 备选（宿主机 bash 有 curl/jq，容器内没有）：
  H="Authorization: %s"; U='http://localhost:%s/cubejs-api/v1/load'
  jq -n '{query:{measures:["cube.measure"],dimensions:[],filters:[],timeDimensions:[],order:{},limit:100}}' > regress/tmp-query.json
  curl -s -H "$H" -H 'Content-Type: application/json' -d @regress/tmp-query.json "$U" | jq '{rows:(.data|length), sample:.data[0:10]}'
  meta 核验：curl -s -H "$H" 'http://localhost:%s/cubejs-api/v1/meta' | jq '.cubes[0:5]'
  # body 外壳 {query:{...}} 只在 curl 形态需要——网关只取 body.query，裸 body 摔 "Query param is required"；
  # cube.js query '<json>' 才吃裸 JSON，两者别混。禁止内联中文 body（git-bash 走 GBK 必 500）——落盘 UTF-8 文件再 -d @file
  # 输出纪律：只打 行数+总量+top10 样本，全量打印会撞 tool 输出 30000 字符截断""" % (auth, port, port)


def _extract_dict_block():
    """③ 口径词典全文（§10.3）：原样注入不改写，歧义处理协议照旧运作。"""
    try:
        with open(os.path.join(PROJECT_DIR, '.claude', 'skills', 'cube-ask',
                               'references', '口径词典.md'), encoding='utf-8') as fh:
            return fh.read().strip()
    except OSError as e:
        return '（口径词典读取失败: %s——按 skill 第1步读 references/口径词典.md）' % e


def _preset_context():
    """D3 预置上下文（§10.3）：①模型摘要 + ②通道配方 + ③口径词典 拼一块。

    层1 每问现扫零缓存（§10.4）——改完模型/词典下一问即生效；禁令：任何启动时
    缓存必须带失效机制，防止未来图省事加缓存引入陈旧。单块失败降级为提示语，
    不阻塞问答（同 _oplog/_log_spawn 失败隔离哲学）。
    """
    return '\n'.join([
        '── ① 模型摘要（机械提取自 conf/model，title/成员/description/ai_context 原文搬运，'
        'views 先 cube 后）──',
        _extract_model_block(),
        '── ② 查询通道（凭据已预填，禁止再读 .env / docker-compose.yml）──',
        _extract_channel_block(),
        '── ③ 口径词典（全文）──',
        _extract_dict_block(),
    ])


def _first_prompt(question):
    """首轮 prompt（§10.3）：指令 + 预置上下文（每问现扫）+ 问题。"""
    return CLAUDE_INSTRUCTION + _preset_context() + '\n\n用户问题：\n' + question


def _claude_bin():
    path = shutil.which('claude') or shutil.which('claude.cmd')
    if not path:
        raise RuntimeError('claude CLI 未找到（宿主机 PATH）——桥依赖 claude CLI')
    return path


def _git_bash():
    """git-bash 路径：CLAUDE_CODE_GIT_BASH_PATH 优先，常见安装位兜底，找不到返回 None。
    claude CLI 靠它选 Bash 工具；定位不到会回退 PowerShell 工具、绕开 bash 通道。
    env 变量必须指向 bash.exe 本体——本机系统级环境变量指到 git-bash.exe（GUI 启动器，
    isfile 通过但不能当 shell，claude 同样回退 PowerShell），故校验 basename。
    不走 shutil.which('bash')——PATH 里可能命中 WindowsApps 的 WSL bash stub。"""
    path = os.environ.get('CLAUDE_CODE_GIT_BASH_PATH')
    if path and os.path.basename(path).lower() == 'bash.exe' and os.path.isfile(path):
        return path
    for cand in (r'D:\develop\Git\bin\bash.exe',
                 r'C:\Program Files\Git\bin\bash.exe',
                 r'C:\Program Files (x86)\Git\bin\bash.exe'):
        if os.path.isfile(cand):
            return cand
    return None


def _now_iso():
    """中国时区 +08:00 ISO 时间（14 号 §4.5）——host 为中国时区，astimezone 即合规。"""
    return datetime.now().astimezone().isoformat(timespec='seconds')


def _now_ms_iso():
    """+08:00 毫秒精度（bridge.log 打点用，14 号 §4.6）。"""
    return datetime.now().astimezone().isoformat(timespec='milliseconds')


def _oplog(level, comp, msg):
    """14 号 §4.6 运维日志：logs/bridge-YYYY-MM-DD.log，经典单行格式按日切片。

    <ISO+08:00 毫秒> <LEVEL> [<组件>] <消息>（LEVEL 五列对齐：INFO 后两空格、ERROR 一空格）；
    写失败只留 stderr 痕，不阻塞问答（同 _log_spawn 失败隔离）。
    """
    try:
        path = os.path.join(PROJECT_DIR, 'logs',
                            'bridge-%s.log' % datetime.now().strftime('%Y-%m-%d'))
        with open(path, 'a', encoding='utf-8') as fh:
            fh.write('%s %-5s [%s] %s\n' % (_now_ms_iso(), level, comp, msg))
    except OSError as e:
        print('bridge.log 写入失败（不阻塞问答）: %s' % e, file=sys.stderr)


def _oplog_block(comp, title, content):
    """14 号 §4.6 内容块（R2.1 拍板：看全量内容而不是字符数）：标题行 + 全量内容逐行。

    标题行 `<ts> INFO  [<comp>] <title> ── N 字符`；内容每行 `<ts> INFO  [<comp>] │ <行>`——
    每行仍带经典前缀（grep/tail 逐行可用），内容全量不截断（jsonl 仍是官方原样）。
    同一事件一次写入（一个 open/write/close），单问锁内无并发交错。
    """
    if isinstance(content, str):
        text = content
    elif content is None:
        text = ''
    else:
        try:
            text = json.dumps(content, ensure_ascii=False)
        except (TypeError, ValueError):
            text = str(content)
    ts = _now_ms_iso()
    lines = ['%s INFO  [%s] %s ── %d 字符' % (ts, comp, title, len(text))]
    for ln in (text.splitlines() or ['']):
        lines.append('%s INFO  [%s] │ %s' % (ts, comp, ln))
    try:
        path = os.path.join(PROJECT_DIR, 'logs',
                            'bridge-%s.log' % datetime.now().strftime('%Y-%m-%d'))
        with open(path, 'a', encoding='utf-8') as fh:
            fh.write('\n'.join(lines) + '\n')
    except OSError as e:
        print('bridge.log 写入失败（不阻塞问答）: %s' % e, file=sys.stderr)


def _result_text(content):
    """tool_result content → 文本：str 原样；list 取各 text 块拼接；其余 JSON 化。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for it in content:
            if isinstance(it, dict) and isinstance(it.get('text'), str):
                parts.append(it['text'])
            else:
                try:
                    parts.append(json.dumps(it, ensure_ascii=False))
                except (TypeError, ValueError):
                    parts.append(str(it))
        return '\n'.join(parts)
    if content is None:
        return ''
    try:
        return json.dumps(content, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(content)


def _log_spawn(session_id, attempt, ev_sid, was_resume, question_head,
               event_lines, stderr_bytes, outcome, duration_ms):
    """14 号 §3/§5 推理层落盘（R2 扁平化）：logs/agent/。

    <HHMMSS>_<attempt>.jsonl = stream-json 事件流（官方格式原样，行内容不动、行尾统一 \n）；
    同名 .stderr.log = claude 自身报错；index.jsonl 每次 spawn 追加一行（串 resume/重建链条，
    行内带 sessionId 字段——扁平化后会话归属靠它记录）。
    失败隔离：任何写失败只留 stderr 痕，不阻塞问答（同 _qa_log_outcome 处理）。
    """
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        base = datetime.now().strftime('%H%M%S') + '_' + attempt
        with open(os.path.join(LOG_DIR, base + '.jsonl'), 'w', encoding='utf-8') as fh:
            for ln in event_lines:
                fh.write(ln + '\n')
        with open(os.path.join(LOG_DIR, base + '.stderr.log'), 'w', encoding='utf-8') as fh:
            fh.write(stderr_bytes.decode('utf-8', 'ignore'))
        entry = {'time': _now_iso(), 'sessionId': session_id or 'default',
                 'attempt': attempt, 'claude_sid': ev_sid,
                 'resume': was_resume, 'question_head': (question_head or '')[:40],
                 'file': base + '.jsonl', 'outcome': outcome, 'duration_ms': duration_ms}
        with open(os.path.join(LOG_DIR, 'index.jsonl'), 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except OSError as e:
        print('日志落盘失败（不阻塞问答）: %s' % e, file=sys.stderr)


def _kill_tree(proc):
    """Windows 下杀 cmd 包装需整树杀（taskkill /T），否则孤儿化 claude.exe（11-v2 §6.1）。"""
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           capture_output=True, timeout=10)
        else:
            proc.kill()
    except (OSError, subprocess.TimeoutExpired):
        try:
            proc.kill()
        except OSError:
            pass


def _spawn_claude(prompt_text, claude_sid=None, session_id='default', attempt='a1',
                  question_head=''):
    """spawn claude -p：首轮 instruction+预置上下文+问题，续轮 --resume。
    返回 (result, session_id, num_turns)——num_turns 供链累计轮数（层3 重建触发用）。

    14 号 §4.2（A 方案）+ R2：--output-format stream-json --verbose；Popen 增量读——
    读线程逐行推队列，主循环 queue.get(timeout) 消费，每行到达即 +08:00 打点 bridge.log
    （[agent] 行，§4.6）；事件流（官方格式原样）落盘 logs/agent/（平铺）；解析取 result 行的
    result/session_id（单对象 json 模式超集）。超时 = 读循环内队列超时 → taskkill /T 杀树
    （Windows 无 select-on-pipe，线程+队列是可移植解）。
    prompt 走 stdin（中文多行免转义）；Windows 下 .cmd/.bat 经 COMSPEC /c 中转；
    env 注入 CLAUDE_CODE_GIT_BASH_PATH——spawn 环境里 claude 定位不到 git-bash 会回退
    PowerShell 工具、绕开 bash 通道（实测 init tools 分叉点）。
    """
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '40']
    args += ['--permission-mode', 'bypassPermissions']
    args += ['--allowedTools', CLAUDE_TOOLS]
    if claude_sid:
        args += ['--resume', claude_sid]
    path = _claude_bin()
    if path.lower().endswith(('.cmd', '.bat')):
        cmd = [os.environ.get('COMSPEC', 'cmd.exe'), '/c', path] + args
    else:
        cmd = [path] + args
    t0 = time.monotonic()
    env = dict(os.environ)
    git_bash = _git_bash()
    if git_bash:
        env['CLAUDE_CODE_GIT_BASH_PATH'] = git_bash   # 覆盖：继承值可能是 git-bash.exe（GUI 启动器，无效）
    # 思考预算封顶（实测 2026-09-28：171s 会话 thinking:text = 21.7:1，每轮 think 5-15s
    # 是第二大耗时）——2048 压短每轮思考；诊断/拍板质量回退时下调此值或移除
    env['MAX_THINKING_TOKENS'] = os.environ.get('MAX_THINKING_TOKENS', '2048')
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, cwd=PROJECT_DIR, env=env)
    except OSError as e:
        _oplog('ERROR', 'claude', '进程启动失败: %s' % e)
        raise RuntimeError('claude 进程启动失败: %s' % e)
    _oplog('INFO ', 'claude', 'spawn %s resume=%s pid=%d' %
           (attempt, claude_sid is not None, proc.pid))
    try:
        proc.stdin.write(prompt_text.encode('utf-8'))
        proc.stdin.close()
    except OSError:
        pass   # 进程早退时 stdin 写失败——错误由 stdout/stderr 路径报出
    stderr_chunks = []

    def _drain_stderr():
        # stderr 不排空会撑爆管道死锁——线程读尽，主循环后 join 取结果
        try:
            stderr_chunks.append(proc.stderr.read())
        except OSError:
            stderr_chunks.append(b'')

    err_t = threading.Thread(target=_drain_stderr, daemon=True)
    err_t.start()

    q = queue.Queue()

    def _read_stdout():
        try:
            for raw in proc.stdout:
                q.put(raw)
        except OSError:
            pass
        q.put(None)   # EOF 哨兵

    threading.Thread(target=_read_stdout, daemon=True).start()

    deadline = time.monotonic() + CLAUDE_TIMEOUT
    timed_out = False
    event_lines = []
    ev_sid, final = claude_sid, {}

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        try:
            raw = q.get(timeout=remaining)
        except queue.Empty:
            timed_out = True
            break
        if raw is None:
            break   # EOF：claude 正常退出
        line = raw.decode('utf-8', 'ignore').strip()
        if not line:
            continue
        event_lines.append(line)
        # 逐行 +08:00 打点（14 号 §4.6；thinking_tokens 等噪音事件跳过）
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = ev.get('type')
        if etype == 'system' and ev.get('subtype') == 'init':
            ev_sid = ev.get('session_id') or ev_sid
            _oplog('INFO ', 'agent', 'init model=%s claude_sid=%s tools=%d' % (
                ev.get('model'), ev_sid, len(ev.get('tools') or [])))
        elif etype == 'assistant':
            for blk in (ev.get('message') or {}).get('content') or []:
                if not isinstance(blk, dict):
                    continue
                bt = blk.get('type')
                if bt == 'thinking':
                    _oplog_block('agent', 'thinking', blk.get('thinking'))
                elif bt == 'tool_use':
                    _oplog_block('agent', 'tool_use %s' % blk.get('name'), blk.get('input'))
                elif bt == 'text':
                    _oplog_block('agent', 'text', blk.get('text'))
        elif etype == 'user':
            for blk in (ev.get('message') or {}).get('content') or []:
                if isinstance(blk, dict) and blk.get('type') == 'tool_result':
                    _oplog_block('agent', 'tool_result', _result_text(blk.get('content')))
        elif etype == 'result':
            final = ev
            ev_sid = ev.get('session_id') or ev_sid
            _oplog('INFO ', 'agent', 'result subtype=%s turns=%s 耗时 %.1fs' % (
                ev.get('subtype'), ev.get('num_turns'), (ev.get('duration_ms') or 0) / 1000.0))

    if timed_out:
        _kill_tree(proc)
    else:
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
    try:
        proc.stdout.close()
        proc.stderr.close()
    except OSError:
        pass
    err_t.join(timeout=5)
    duration_ms = int((time.monotonic() - t0) * 1000)
    stderr_b = stderr_chunks[0] if stderr_chunks else b''
    outcome = 'timeout' if timed_out else ('ok' if proc.returncode == 0 else 'error')
    _log_spawn(session_id, attempt, ev_sid, claude_sid is not None, question_head,
               event_lines, stderr_b, outcome, duration_ms)
    if timed_out:
        _oplog('ERROR', 'claude', '调用超时（%ds）——已杀进程树 pid=%d' % (CLAUDE_TIMEOUT, proc.pid))
        raise RuntimeError('claude 调用超时（%ds）——问题过重或 claude 挂起' % CLAUDE_TIMEOUT)
    _oplog('INFO ', 'claude', 'exit code=%s 耗时 %.1fs' % (proc.returncode, duration_ms / 1000.0))
    if proc.returncode != 0:
        _oplog('ERROR', 'claude', '调用失败（exit %s）: %s' % (
            proc.returncode, stderr_b.decode('utf-8', 'ignore')[:200]))
        raise RuntimeError('claude 调用失败（exit %s）: %s' % (
            proc.returncode, stderr_b.decode('utf-8', 'ignore')[:300]))
    result_text = (final.get('result') or '') if isinstance(final, dict) else ''
    ev_sid = (final.get('session_id') or ev_sid) if isinstance(final, dict) else ev_sid
    nturns = (final.get('num_turns') or 0) if isinstance(final, dict) else 0
    return result_text, ev_sid, nturns


def _extract_json(text):
    """剥掉可能的 ```json 围栏，取第一个完整 JSON 对象（claude 最终输出 → 三态响应）。"""
    text = (text or '').strip()
    fence = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.S)
    if fence:
        text = fence.group(1)
    start = text.find('{')
    if start < 0:
        raise ValueError('claude 输出中无 JSON')
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError('claude 输出 JSON 未闭合')


def _normalize(resp):
    """claude 输出形态兜底：action→type 同名映射（query→answer）+ tables 平等契约防漂移。

    实测漂移两型（11 号 §6 / 17 号 §2.2）：
      ① data 重组为 [{scope, rows:[...]}] 嵌套（09-24）——展平；
      ② 新契约下仍输出裸 query+data、无 tables ——包装成 tables[0]（query 取答案级
        query 残留，total 置 null：分母没经全量查询验证，宁缺毋错，前端不出占比列）。
    兜底全部 stderr 留痕，不静默；tables 正常时 data 字段一律剥除（契约里它不存在）。
    """
    if 'type' not in resp and 'action' in resp:
        resp['type'] = {'query': 'answer', 'ask': 'ask', 'nomatch': 'nomatch'}.get(resp['action'], 'answer')
    data = resp.get('data')
    flat = None
    if isinstance(data, list) and any(
            isinstance(r, dict) and isinstance(r.get('rows'), list) for r in data):
        flat = []
        for r in data:
            if isinstance(r, dict) and isinstance(r.get('rows'), list):
                flat.extend(r['rows'])
            else:
                flat.append(r)
        print('data 嵌套 {scope,rows} 已展平（%d 行）——claude 契约漂移' % len(flat), file=sys.stderr)
    tables = resp.get('tables')
    if isinstance(tables, list) and tables:
        resp.pop('data', None)   # 平等契约：data 字段不存在
    else:
        rows = flat if flat is not None else (data if isinstance(data, list) else [])
        if rows:
            resp['tables'] = [{'title': '口径1', 'query': resp.get('query') or {},
                               'rows': rows, 'total': None}]
            resp.pop('data', None)
            print('裸 data 无 tables，已包装 tables[0]（%d 行，total=null）——claude 契约漂移'
                  % len(rows), file=sys.stderr)
    return resp


def _bridge(question, session, session_id='default'):
    """桥：一次 claude 调用（首轮或续轮）→ 三态响应。

    首轮发 _first_prompt（指令 + 预置上下文 + 问题，每问现扫 §10.3）；续轮只发
    用户回复（约束在 claude 上下文里，--resume 持久）。会话重建（§10.4 层2/层3，
    同一路径：丢 claude_sid 按首轮重注最新预置上下文，WARN 留痕）：
      层2 空闲超 SESSION_TTL；层3 resume 链累计轮数（session['turns']）超上限。
    resume 失败（exit）自动重建会话重试一次；三态解析失败重试 1 次
    （附提醒，走 --resume 保上下文），仍失败明确报错（不静默降级，v2 文档 §8）。
    attempt 序号（a1/a2/a3…）随每次 spawn 递增，落盘文件名与 index 行对应（14 号 §3）。
    """
    n = 0

    def _try(prompt_text, claude_sid):
        nonlocal n
        n += 1
        return _spawn_claude(prompt_text, claude_sid, session_id, 'a%d' % n, question)

    claude_sid = session.get('claude_sid')
    # 层2/层3 重建检查（空闲超时 / 链轮数超限）——只对续轮有意义（首轮本就重注）
    last = session.get('last_active')
    idle_s = (time.time() - last) if last else 0.0
    turns = session.get('turns', 0)
    if claude_sid and idle_s > SESSION_TTL:
        _oplog('WARN ', 'bridge', '会话空闲 %.0fs 超 %ds，重建（重注预置上下文）'
               % (idle_s, SESSION_TTL))
        claude_sid = None
        session['claude_sid'] = None
        session['turns'] = 0
    elif claude_sid and turns >= SESSION_MAX_TURNS:
        _oplog('WARN ', 'bridge', 'resume 链累计 %d 轮超上限 %d，重建（重注预置上下文）'
               % (turns, SESSION_MAX_TURNS))
        claude_sid = None
        session['claude_sid'] = None
        session['turns'] = 0
    prompt_text = question if claude_sid else _first_prompt(question)
    try:
        result, new_sid, nturns = _try(prompt_text, claude_sid)
    except RuntimeError as e:
        if claude_sid and 'exit ' in str(e):
            _oplog('WARN ', 'claude', 'resume 失败，重建会话: %s' % str(e)[:120])
            result, new_sid, nturns = _try(_first_prompt(question), None)
        else:
            raise
    if new_sid:
        session['claude_sid'] = new_sid
    # 链累计轮数（层3 重建触发依据）+ 活跃时间戳（层2 重建触发依据）
    session['turns'] = session.get('turns', 0) + (nturns or 0)
    session['last_active'] = time.time()
    try:
        resp = _normalize(_extract_json(result))
    except (ValueError, json.JSONDecodeError) as e:
        _oplog('WARN ', 'bridge', 'claude 输出非三态 JSON，重试 1 次: %s' % str(e)[:120])
        print('claude 输出非三态 JSON（重试 1 次）: %s | raw 头 300: %r'
              % (e, (result or '')[:300]), file=sys.stderr)
        result, _, _ = _try('（上一条输出不是合法的三态 JSON——请严格按约束只输出一个 JSON 对象）',
                            session.get('claude_sid'))
        session['last_active'] = time.time()
        try:
            resp = _normalize(_extract_json(result))
        except (ValueError, json.JSONDecodeError) as e2:
            raise RuntimeError('claude 最终输出非三态 JSON: %s' % e2)
    return resp


def _cube_prefixes(queries):
    """成员来源 → cube/view 前缀，去重保序（14 号 §4.1 cube 字段）。
    入参元素两型：query dict（按 measures→dimensions→filters→timeDimensions 扫）
    或裸成员名 str（plan 回退用）；联查 view 多前缀逗号并存。"""
    seen, out = set(), []
    for q in queries or []:
        members = []
        if isinstance(q, dict):
            members = list(q.get('measures') or []) + list(q.get('dimensions') or [])
            members += [f.get('member') for f in (q.get('filters') or [])
                        if isinstance(f, dict) and f.get('member')]
            members += [td.get('member') for td in (q.get('timeDimensions') or [])
                        if isinstance(td, dict) and td.get('member')]
        elif isinstance(q, str):
            members = [q]
        for m in members:
            if isinstance(m, str) and '.' in m:
                p = m.split('.', 1)[0]
                if p and p not in seen:
                    seen.add(p)
                    out.append(p)
    return out


def _qa_log_answer(question, resp):
    """answer 行由桥从最终三态 JSON 机械派生（14 号 §4.1 R3 桥单写）——
    plan/tables[].query/assumption/truncated/rows 全是契约字段现成值，零语义加工，
    claude 不再手写日志（skill 第6步模板已删）。挂点在 _send 之前（浏览器断连照落）；
    写失败只留 stderr 痕，不阻塞问答。"""
    try:
        tables = resp.get('tables') or []
        queries = [t.get('query') for t in tables
                   if isinstance(t, dict) and t.get('query')]
        prefixes = _cube_prefixes(queries) or _cube_prefixes(
            [p[1] for p in (resp.get('plan') or [])
             if isinstance(p, (list, tuple)) and len(p) > 1])
        row = {
            'time': _now_iso(),
            'question': question,
            'cube': ','.join(prefixes) if prefixes else None,
            'plan': resp.get('plan'),
            'queries': queries,
            'query': queries[0] if queries else None,   # 过渡兼容：读侧迁 queries 后删除
            'assumption': resp.get('assumption'),
            'truncated': bool(resp.get('truncated')),
            'rows': resp.get('rows'),
            'source': 'ui',
        }
        os.makedirs(os.path.dirname(QA_LOG_PATH), exist_ok=True)
        with open(QA_LOG_PATH, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    except OSError as e:
        print('qa-log(answer) 写入失败（不阻塞问答）: %s' % e, file=sys.stderr)


def _qa_log_outcome(question, resp):
    """ask/nomatch/error 补审计（v1 12 节逻辑收编进桥）——问了但没出数的问题有痕。
    answer 行由 _qa_log_answer 从最终 JSON 派生（14 号 §4.1 R3：qa-log 桥单写）。"""
    entry = {
        'time': _now_iso(),
        'question': question,
        'outcome': resp.get('type', 'error'),
        'answered': False,
        'source': 'ui',
    }
    if resp.get('type') == 'ask':
        entry['ask_question'] = resp.get('question')
        entry['options'] = resp.get('options', [])
    elif resp.get('type') == 'nomatch':
        entry['gaps'] = resp.get('gaps', [])
    else:
        entry['error'] = resp.get('error')
    try:
        with open(QA_LOG_PATH, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except OSError as e:
        print('qa-log 写入失败（不阻塞问答）: %s' % e, file=sys.stderr)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')   # v1 dev 简化沿用
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/':
            self._send(200, {'service': 'cube-ai-agent', 'version': 'v2-bridge（claude 全代理，14 号日志 R3：qa-log 桥单写）',
                             'sessions': {k: v.get('claude_sid') for k, v in _SESSIONS.items()},
                             'claude_cli': bool(shutil.which('claude') or shutil.which('claude.cmd'))})
        else:
            self._send(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/chat':
            self._send(404, {'error': 'not found'})
            return
        question = None
        session_id = 'default'
        try:
            length = int(self.headers.get('Content-Length', '0'))
            req = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
            question = (req.get('question') or '').strip()
            if not question:
                self._send(400, {'error': 'question 不能为空'})
                return
            session_id = req.get('sessionId', 'default')
            _oplog('INFO ', 'bridge', '收到问题 sessionId=%s "%s"' % (session_id, question[:60]))
            # R2 §4.6：锁排队行——前问未完时排队请求不再隐身
            if not _LOCK.acquire(blocking=False):
                _oplog('INFO ', 'bridge', '等待会话锁（前问未完）...')
                _LOCK.acquire()
            try:
                session = _SESSIONS.setdefault(session_id, {})
                resp = _bridge(question, session, session_id)
            finally:
                _LOCK.release()
        except Exception as e:  # 任何失败明确返回错误，不静默
            _oplog('ERROR', 'bridge', '问答失败: %s' % str(e)[:200])
            if question:
                _qa_log_outcome(question, {'type': 'error', 'error': str(e)})
            self._send(500, {'type': 'error', 'error': str(e)})
            return
        if resp.get('type') != 'answer':
            _qa_log_outcome(question, resp)   # ask/nomatch 也落审计（answered: false）
        else:
            _qa_log_answer(question, resp)   # answer 行桥派生（14 号 §4.1 R3 桥单写，_send 前落）
        try:
            self._send(200, resp)
            _oplog('INFO ', 'bridge', '响应已送 %s sessionId=%s' % (resp.get('type'), session_id))
        except OSError:
            # 浏览器已断开（页面刷新/关面板）——答案计算完成但送不到，丢弃即可；
            # 不能落 except 误记 error 审计（实测 10:29:50 各票种金额答案白算还脏了日志）
            _oplog('WARN ', 'bridge', '响应送出失败（浏览器已断开）: %s' % question[:40])


if __name__ == '__main__':
    os.makedirs(LOG_DIR, exist_ok=True)   # logs/agent/（_log_spawn 落盘需目录已在；qa-log 由 _qa_log_answer 自建目录）
    print('Cube AI Agent v2 桥监听 :%d（POST /chat → claude 会话；日志 14 号 R3：'
          'logs/qa-log.jsonl（桥单写） + logs/agent/ + logs/bridge-YYYY-MM-DD.log）' % PORT)
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
