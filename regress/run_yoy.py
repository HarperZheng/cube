#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同环比验证用例的自动执行器——回答一个问题："28 号方案建的同比/环比成员，现在还都对吗？"

目的：
  批 1/2/3 落地或改模热重载后，人工逐条发查询、对锚点数字太慢也容易看漏。
  本脚本把 yoy.queries.json 里的用例自动发给 Cube，拿实际结果与文件里
  写死的锚点数字（如 2023 年缴款金额 1465810.31）逐个比对——全对说明
  模型和数据口径没被改坏，某条不对就精确定位到是哪个数漂了。

输入（读本脚本同目录两个文件）：
  yoy.queries.json      用例清单：每条 = query（发什么请求）+ expect（该得什么数）
  fiscal.baseline.json  旧基础查询的历史结果（regress 型用例拿它做回归对照）

输出：
  终端                每条用例一行 PASS/FAIL，最后汇总几条过几条
  yoy.report.json     逐条明细：失败的具体差异（哪个数、期望多少、实际多少）
  yoy.baseline.json   query 型用例的实际结果存档——下次改模后跑，
                      先对照这份快照，旧数字漂了立刻知道

用法（在 cube 容器内跑；git-bash 传容器路径须加 MSYS_NO_PATHCONV=1 防改写）：
  MSYS_NO_PATHCONV=1 docker exec cube python3 /cube/regress/run_yoy.py

主流程在 main()：读用例 → 按每条的 type 分发到四个执行函数
（case_query 发查询对锚点 / case_meta 核成员透出 / case_sql 核生成 SQL
形态 / case_regress 重放老查询基线）→ 汇总 → 写上面两个输出文件。

比对规则：金额/笔数/差值按 Decimal 精确相等（"830" 与 "830.00" 算相等）；
*_rate 列按容差 0.005 近似；expect 写 null 的格子，实际也必须是 null
（同期无数据报 null 而非 0，28 号方案 §六第 4 条）。

退出码：全过 0；有用例 FAIL 1；缺 secret 等环境问题 2。
"""

import json
import os
import sys
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest

BASE = Path(__file__).resolve().parent
QUERIES = BASE / 'yoy.queries.json'
OLD_BASELINE = BASE / 'fiscal.baseline.json'
OUT_BASELINE = BASE / 'yoy.baseline.json'
REPORT = BASE / 'yoy.report.json'

API = os.environ.get('YOY_API_BASE', 'http://127.0.0.1:4000')
SECRET = os.environ.get('YOY_API_SECRET') or os.environ.get('CUBEJS_API_SECRET')
TIMEOUT = int(os.environ.get('YOY_TIMEOUT', '300'))

RATE_TOL = Decimal('0.005')  # rate 列近似容差
POLL_SECONDS = 120           # continueWait 轮询总时限


def http(path, body=None):
    """执行：给 Cube（127.0.0.1:4000）发一个带 Bearer 认证的请求，返回解析后的 JSON——所有用例的底层出口。"""
    req = urlrequest.Request(
        API + path,
        data=json.dumps(body).encode('utf-8') if body is not None else None,
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer %s' % SECRET},
        method='POST' if body is not None else 'GET')
    with urlrequest.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode('utf-8'))


def load_query(query):
    """执行：把一条 query 发到原生 /cubejs-api/v1/load 取回数据行。
    renewQuery 绕 query cache（改模后旧缓存会毒害结果，28 号注意点 11）；
    Continue wait 时轮询等结果；HTTP 报错透出响应 body 便于定位。"""
    deadline = time.time() + POLL_SECONDS
    while True:
        try:
            resp = http('/cubejs-api/v1/load', {'query': query, 'renewQuery': True})
        except urlerror.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')[:500]
            raise RuntimeError('HTTP %s: %s' % (e.code, body))
        err = resp.get('error')
        # Continue wait 两种包法：{"continueWait": true} 与 {"error": "Continue wait"}（网关让步形态，整包重查并发时常见）
        if resp.get('continueWait') or (isinstance(err, str) and 'continue wait' in err.lower()):
            if time.time() > deadline:
                raise RuntimeError('continueWait 超过 %d 秒' % POLL_SECONDS)
            time.sleep(1)
            continue
        if resp.get('error'):
            raise RuntimeError('load error: ' + json.dumps(resp['error'], ensure_ascii=False))
        return resp.get('data') or []


def norm(v):
    """准备比对：把引擎返回值归一成可比形态——null/缺失/空串统一当 null
    （同期无数据），数字样字符串转 Decimal（金额要精确比），其余留原样。"""
    if v is None:
        return None
    s = str(v).strip()
    if s == '':
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return s


def eq(col, actual, expected):
    """核查单格：金额/笔数/差值精确相等；*_rate 按容差 0.005 近似
    （expect 是三位小数内的写法）；null 必须对 null，不能拿 0 冒充无数据。"""
    if actual is None or expected is None:
        return actual is None and expected is None
    if isinstance(actual, Decimal) and isinstance(expected, Decimal):
        if col.endswith('_rate'):
            return abs(actual - expected) <= RATE_TOL
        return actual == expected
    return str(actual) == str(expected)


def short_name(key):
    """工具：全名截短名——"fiscal_treasury_view.amt" → "amt"，与 expect 里写的短名对上号。"""
    return key.split('.')[-1]


def row_key(row, granularity):
    """工具：从结果行的时间列取出行键（2022 / 2022-02 / 2022Q2），
    用来把 expect.rows 的期望表和实际行一一对号。"""
    suffix = '.' + granularity
    for k, v in row.items():
        if k.endswith(suffix):
            v = str(v)
            if granularity == 'year':
                return v[:4]
            if granularity == 'month':
                return v[:7]
            # quarter：Cube 返回日期形态 2022-04-01T...，转 2022Q2（带 Q 直接用）
            return v if 'Q' in v else '%sQ%d' % (v[:4], (int(v[5:7]) - 1) // 3 + 1)
    return None


def case_query(case):
    """核查同环比数字算得对不对（主证据）：把用例 query 发给 /load 拿回结果，
    按时间（年/月/季）对号入座，逐格与 expect.rows 里的期望值比对——
    本期值、同比差值、同比增长率都要对上；去年没有数据的期，
    差值和增长率必须是 null 而不是 0（"没数据"和"零增长"是两回事）。"""
    q = case['query']
    td = q['timeDimensions'][0]
    gran = td.get('granularity')
    data = load_query(q)
    exp = case.get('expect', {})
    if not data and exp.get('rows'):
        # CK 抖动期失败可能被静默成 0 行（注意点 11 变种），expect 有行时重试一次
        time.sleep(2)
        data = load_query(q)

    actual = {}
    for row in data:
        rk = row_key(row, gran)
        if rk is None:
            continue
        actual[rk] = {short_name(k): norm(v) for k, v in row.items()
                      if not k.endswith('.' + gran)}

    exp = case.get('expect', {})
    details, ok = [], True
    for rk, cols in exp.get('rows', {}).items():
        if rk not in actual:
            ok = False
            details.append('row %s 缺失（实际行键: %s）' % (rk, sorted(actual)))
            continue
        for col, want in cols.items():
            got = actual[rk].get(col)
            if not eq(col, got, norm(want)):
                ok = False
                details.append('%s.%s 期望 %s 实际 %s' % (rk, col, want, got))
    # 平移键行：引擎键集=本期∪平移期的行为证据；首度量列须为 null
    for rk in exp.get('shiftKeyRows', []):
        first = short_name(q['measures'][0])
        if rk not in actual:
            ok = False
            details.append('平移键行 %s 缺失（键集应含本期∪平移期）' % rk)
        elif actual[rk].get(first) is not None:
            ok = False
            details.append('平移键行 %s.%s 应为 null，实际 %s' % (rk, first, actual[rk][first]))
    return ok, details, {'data': data}


def case_meta(case):
    """核查问数侧能看到的成员清单对不对：调 GET /agent/meta/<view> 取回成员清单，查两点——
    差值/增长率成员（amt_yoy_diff 这些）必须在清单里，问数要用；
    中间计算成员（amt_ly = "去年同期金额"，只是差值算式里的减数，本身没有业务含义）
    和已废弃的旧成员（amt_same_period_ly）不能出现在清单里，防止问数误用。"""
    endpoint = case['endpoint']
    path = endpoint.split(' ', 1)[1] if endpoint.upper().startswith('GET ') else endpoint
    resp = http(path)
    names = {m['name'].split('.')[-1] for m in resp.get('measures', [])}
    exp = case.get('expect', {})
    details, ok = [], True
    for want in exp.get('containsMeasures', []):
        if want not in names:
            ok = False
            details.append('成员 %s 未透出' % want)
    for want in exp.get('notContainsMeasures', []):
        if want in names:
            ok = False
            details.append('成员 %s 不应透出（伴生/存量须撤出 view includes）' % want)
    return ok, details, None


def case_sql(case):
    """核查 CK 23.3 兼容补丁还生效：调 /cubejs-api/v1/sql 拿引擎生成的 SQL，确认
    "去年同期"是按 (日期列 + INTERVAL 1 YEAR) 写的——CK 23.3 只认这个写法；
    不能退回新版才支持的 addDate / isNotDistinctFrom 写法（本库 CK 23.3 会报错）。
    断言不过时把响应存到 yoy.sql-debug.json，供人工检查差异。"""
    exp = case.get('expect', {})
    missing, extra = [], []
    for attempt in range(2):
        resp = http('/cubejs-api/v1/sql', {'query': case['query']})
        text = json.dumps(resp, ensure_ascii=False).lower()
        missing = [w for w in exp.get('contains', []) if w.lower() not in text]
        extra = [w for w in exp.get('notContains', []) if w.lower() in text]
        if not missing or attempt == 1:
            break
        time.sleep(2)  # CK 抖动期 /sql 可能返回降级形态，隔 2 秒重取一次再判
    if missing:  # 最终仍缺片段 → 落盘取证，供人工对比（/tmp/yoy_sql_debug.json）
        try:
            (BASE / 'yoy.sql-debug.json').write_text(json.dumps(resp, ensure_ascii=False, indent=1), encoding='utf-8')
        except Exception:
            pass
    details = ['SQL 缺少片段: %s' % w for w in missing]
    details += ['SQL 不应包含: %s' % w for w in extra]
    details.append('另请人工核对 enter_status filter 同时出现在本期与平移子查询')
    return (not missing and not extra), details, None


def case_regress(case):
    """核查改模型没弄坏老查询：把 fiscal.baseline.json 里存档的每条老查询重放一遍，
    和当时存下的结果逐行比（不要求行顺序一致，只看每行的内容）——
    老查询的数字只要变了，就在这里报出来。"""
    baseline = json.loads(OLD_BASELINE.read_text(encoding='utf-8'))
    details, ok = [], True
    for item in baseline.get('results', []):
        try:
            data = load_query(item['query'])
        except Exception as e:
            ok = False
            details.append('[%s] 重放失败: %s' % (item.get('name'), e))
            continue
        want = (item.get('resultSet') or {}).get('data') or []
        if len(data) != len(want):
            ok = False
            details.append('[%s] 行数 基线 %d / 实际 %d' % (item.get('name'), len(want), len(data)))
            continue
        # 序不敏感比对：order 并列键的行序本无保证，按行内容签名排序后逐行比
        sig = lambda row: sorted((k, str(norm(v))) for k, v in row.items())
        want_s, act_s = sorted(map(sig, want)), sorted(map(sig, data))
        for i, (rw, ra) in enumerate(zip(want_s, act_s)):
            if rw == ra:
                continue
            for k, v in dict(rw).items():
                rv = dict(ra).get(k)
                if str(rv) != v:
                    ok = False
                    details.append('[%s] %s: 基线 %s / 实际 %s'
                                   % (item.get('name'), short_name(k), v, rv))
                    break  # 每行只报第一处差异
    return ok, details, None


DISPATCH = {'query': case_query, 'meta': case_meta, 'sql': case_sql, 'regress': case_regress}


def main():
    """入口：读用例 → 逐条按 type 分发执行并比对 → 写报告与基线快照 → 返回退出码。"""
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    if SECRET is None:
        print('缺少 API secret：容器内应自带 CUBEJS_API_SECRET（compose env_file）；'
              '宿主机跑请设 YOY_API_SECRET。')
        return 2
    if not QUERIES.exists():
        print('用例文件不存在: %s' % QUERIES)
        return 2

    cases = json.loads(QUERIES.read_text(encoding='utf-8'))
    results, backfill, passed = [], [], 0
    for case in cases:
        name = case.get('name', '?')
        fn = DISPATCH.get(case.get('type'))
        if fn is None:
            ok, details = False, ['未知 type: %s' % case.get('type')]
        else:
            try:
                ok, details, rs = fn(case)
            except Exception as e:
                ok, details, rs = False, ['执行异常: %s' % e], None
        results.append({'name': name, 'type': case.get('type'), 'ok': ok, 'details': details})
        passed += 1 if ok else 0
        if rs is not None:
            backfill.append({'name': name, 'query': case['query'],
                             'resultSet': {'data': rs['data']}})
        print(('PASS ' if ok else 'FAIL ') + name)
        for d in details:
            print('      ' + d)

    REPORT.write_text(
        json.dumps({'savedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                    'passed': passed, 'total': len(cases), 'results': results},
                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if backfill:
        OUT_BASELINE.write_text(
            json.dumps({'savedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                        'results': backfill}, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8')
    print('%d/%d passed; report -> %s%s' % (
        passed, len(cases), REPORT.name,
        ('; baseline -> %s' % OUT_BASELINE.name) if backfill else ''))
    return 0 if passed == len(cases) else 1


if __name__ == '__main__':
    sys.exit(main())
