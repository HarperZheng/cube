#!/usr/bin/env node
/**
 * Cube REST API CLI —— 语义层对接工具（在 cube 容器内运行，宿主机无需 Node）
 *
 * 用法（宿主机执行，Git Bash 下用 sh -c 包一层防路径改写）：
 *   docker exec cube sh -c "node /cube/agent/cube.js secret"                 打印当前 apiSecret
 *   docker exec cube sh -c "node /cube/agent/cube.js check"                  健康检查：连通性 + 模型编译状态
 *   docker exec cube sh -c "node /cube/agent/cube.js meta [cubeName]"        列出 cube 及全部成员（维度/度量）
 *   docker exec cube sh -c "node /cube/agent/cube.js query '<json>'"         执行查询，表格化输出
 *   docker exec cube sh -c "node /cube/agent/cube.js query -f q.json"        从文件读查询定义
 *   docker exec cube sh -c "node /cube/agent/cube.js snap baseline.json -f queries.json"
 *                                             批量执行并保存结果（回归基线）
 *   docker exec cube sh -c "node /cube/agent/cube.js diff baseline.json -f queries.json"
 *                                             对比当前结果与基线，报告差异
 *
 * queries.json 格式：[ { "name": "票据粒度汇总", "query": { ...cube query... } } ]
 */
'use strict';
const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const HOST = process.env.CUBE_API_HOST || 'localhost';
const PORT = process.env.CUBE_API_PORT || 4000;

function getSecret() {
  // 优先读 env（.env 的 CUBEJS_API_SECRET 经 env_file 注入容器，
  // 同容器内天然可得，且固定不变——重启不再重新生成）
  if (process.env.CUBEJS_API_SECRET) {
    return process.env.CUBEJS_API_SECRET;
  }
  // 回退：未设 env 时从容器日志提取（dev 模式自动生成的 secret，重启即变）
  const logs = execSync('docker logs cube 2>&1', {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const found = [...logs.matchAll(/generated it as ([a-f0-9]+)/g)];
  if (!found.length) {
    throw new Error('未找到 apiSecret：在 .env 设 CUBEJS_API_SECRET，或检查容器是否已启动');
  }
  return found[found.length - 1][1]; // 取最近一次重启的 secret
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path,
        method,
        headers: {
          Authorization: getSecret(),
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 120000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`非 JSON 响应(${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- 查询结果表格化 ----
function printTable(resultSet) {
  const data = resultSet.data || [];
  if (!data.length) {
    console.log('(0 行)');
    return;
  }
  const cols = Object.keys(data[0]);
  const rows = data.map((r) =>
    cols.map((c) => (r[c] === null || r[c] === undefined ? 'null' : String(r[c])))
  );
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...rows.map((r) => [...r[i]].length))
  );
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - [...s].length));
  console.log(cols.map((c, i) => pad(c, widths[i])).join(' | '));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  rows.forEach((r) => console.log(r.map((v, i) => pad(v, widths[i])).join(' | ')));
  console.log(`(${data.length} 行)`);
}

// ---- 查询文件 ----
function loadQueries(flagValue) {
  const text = fs.readFileSync(flagValue, 'utf8');
  const parsed = JSON.parse(text);
  // 兼容两种形态：回归用例数组 [{name, query}]；裸查询对象 {measures,...}（临时查询落盘）
  if (Array.isArray(parsed)) return parsed;
  return [{ name: '(文件查询)', query: parsed }];
}

// ---- 回归对比 ----
function rowKey(row) {
  return JSON.stringify(row);
}
function diffResults(baseline, current) {
  const problems = [];
  baseline.forEach((b) => {
    const c = current.find((x) => x.name === b.name);
    if (!c) {
      problems.push(`[缺失] 查询 "${b.name}" 未在当前查询文件中找到`);
      return;
    }
    const baseRows = (b.resultSet && b.resultSet.data) || [];
    const curRows = (c.resultSet && c.resultSet.data) || [];
    const baseMap = new Map(baseRows.map((r) => [rowKey(r), 1]));
    const curMap = new Map(curRows.map((r) => [rowKey(r), 1]));
    const changed = baseRows.filter((r) => !curMap.has(rowKey(r)));
    const added = curRows.filter((r) => !baseMap.has(rowKey(r)));
    if (baseRows.length !== curRows.length || changed.length || added.length) {
      problems.push(
        `[不一致] "${b.name}": 基线 ${baseRows.length} 行 → 当前 ${curRows.length} 行` +
          (changed.length ? `，${changed.length} 行变化（如 ${JSON.stringify(changed[0]).slice(0, 160)}）` : '') +
          (added.length ? `，${added.length} 行新增（如 ${JSON.stringify(added[0]).slice(0, 160)}）` : '')
      );
    }
  });
  return problems;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'secret':
      console.log(getSecret());
      break;

    case 'check': {
      const meta = await api('GET', '/cubejs-api/v1/meta');
      const cubes = (meta.cubes || []).map((c) => c.name);
      console.log(`API 连通: OK；dbType: ${meta.dbType || '(见各cube)'}；cubes: ${cubes.join(', ') || '(无)'}`);
      break;
    }

    case 'meta': {
      const meta = await api('GET', '/cubejs-api/v1/meta');
      const wanted = rest[0];
      (meta.cubes || [])
        .filter((c) => !wanted || c.name === wanted)
        .forEach((c) => {
          console.log(`# cube: ${c.name}  (title: ${c.title || '-'})`);
          (c.measures || []).forEach((m) =>
            console.log(`  measure   ${m.name}  ${m.shortTitle || ''}${m.description ? '  // ' + m.description : ''}`)
          );
          (c.dimensions || []).forEach((d) =>
            console.log(`  dimension ${d.name}  ${d.type}  ${d.shortTitle || ''}`)
          );
        });
      break;
    }

    case 'query': {
      const arg = rest[0];
      if (!arg) throw new Error('用法: query \'<json>\' 或 query -f 文件');
      const query = arg === '-f' ? loadQueries(rest[1])[0].query : JSON.parse(arg);
      const res = await api('POST', '/cubejs-api/v1/load', { query });
      if (res.error) throw new Error(res.error);
      printTable(res);
      // P6 命中自报：usedPreAggregations 有值 = 查询走了 Cube Store（预聚合）
      const used = res.usedPreAggregations && Object.keys(res.usedPreAggregations);
      console.log(used && used.length
        ? `[预聚合命中] ${used.join(', ')}（extDbType: ${res.extDbType || '-'}，external: ${res.external}）`
        : '[未命中预聚合] 走源库（Oracle）查询');
      break;
    }

    case 'sql': {
      const arg = rest[0];
      if (!arg) throw new Error('用法: sql \'<json>\' 或 sql -f 文件');
      const query = arg === '-f' ? loadQueries(rest[1])[0].query : JSON.parse(arg);
      const res = await api('POST', '/cubejs-api/v1/sql', { query });
      if (res.error) throw new Error(res.error);
      const s = res.sql || {};
      // P6：external: true + FROM dev_pre_aggregations.* = 查询走 Cube Store 预聚合
      console.log(`external: ${s.external}`);
      (s.sql || []).forEach((stmt) => console.log(stmt));
      break;
    }

    case 'cubestore': {
      // Cube Store 直查（内嵌 MySQL 协议 13306）：dev_pre_aggregations 预聚合表的真相。
      // 三层工具对称：db.js 查 Oracle、query 查语义层、cubestore 查 Cube Store。
      // 方言注意：不支持 SHOW TABLES；双引号是标识符，字符串字面量用单引号。
      const mysql = require('/cube/node_modules/mysql2/promise.js');
      const sqlText = rest[0];
      if (!sqlText) throw new Error("用法: cubestore '<sql>'（information_schema 或预聚合表，Cube Store 方言）");
      const conn = await mysql.createConnection({ host: 'localhost', port: 13306, user: 'root', password: '' });
      try {
        const [rows] = await conn.query(sqlText);
        if (!rows.length) { console.log('(0 行)'); break; }
        const cols = Object.keys(rows[0]);
        console.log(cols.join(' | '));
        rows.slice(0, 50).forEach((r) => console.log(cols.map((c) => (r[c] === null ? 'null' : String(r[c]))).join(' | ')));
        console.log(`(${rows.length} 行${rows.length > 50 ? '，显示前50' : ''})`);
      } finally { await conn.end(); }
      break;
    }

    case 'snap':
    case 'diff': {
      const baselineFile = rest[0];
      const fIdx = rest.indexOf('-f');
      const queriesFile = fIdx >= 0 ? rest[fIdx + 1] : undefined;
      if (!queriesFile) throw new Error('用法: snap|diff 基线.json -f queries.json');
      const queries = loadQueries(queriesFile);
      const results = [];
      for (const q of queries) {
        const res = await api('POST', '/cubejs-api/v1/load', { query: q.query });
        if (res.error) throw new Error(`查询 "${q.name}" 失败: ${res.error}`);
        results.push({ name: q.name, query: q.query, resultSet: { data: res.data || [] } });
        console.log(`已执行: ${q.name} (${(res.data || []).length} 行)`);
      }
      if (cmd === 'snap') {
        fs.writeFileSync(baselineFile, JSON.stringify({ savedAt: new Date().toISOString(), results }, null, 2));
        console.log(`基线已保存: ${baselineFile}`);
      } else {
        if (!fs.existsSync(baselineFile)) throw new Error(`基线文件不存在: ${baselineFile}`);
        const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')).results || [];
        const problems = diffResults(baseline, results);
        if (problems.length) {
          console.log('\n=== 回归发现问题 ===');
          problems.forEach((p) => console.log(p));
          process.exit(1);
        }
        console.log('\n=== 回归通过：与基线完全一致 ===');
      }
      break;
    }

    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('/**')[1].split('*/')[0]);
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
