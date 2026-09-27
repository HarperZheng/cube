const oracledb = require('oracledb');
try {
  oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR || '/opt/oracle-client' });
  console.error('[preload] oracledb forced to THICK mode');
} catch (e) {
  if (!/already initialized/i.test(e.message)) throw e;
}

// ---------------------------------------------------------------
// Oracle 11g 兼容补丁：
// Cube 的 Oracle 方言生成分页用 "OFFSET n ROWS FETCH NEXT m ROWS ONLY"（12c+ 语法），
// 11g 报 ORA-00933。这里在驱动执行前改写为 ROWNUM 子查询写法。
// ---------------------------------------------------------------
try {
  const mod = require('/cube/node_modules/@cubejs-backend/oracle-driver/driver/OracleDriver.js');
  const OD = mod.OracleDriver || mod;
  const origNormalize = OD.normalizeParams;

  OD.normalizeParams = function (query, values) {
    const r = origNormalize.call(this, query, values);
    r.sql = rewrite11gPaging(r.sql);
    return r;
  };

  function rewrite11gPaging(sql) {
    if (typeof sql !== 'string') return sql;

    // 带偏移：OFFSET x ROWS FETCH NEXT y ROWS ONLY
    let m = sql.match(/\sOFFSET\s+(\d+)\s+ROWS\s+FETCH\s+NEXT\s+(\d+)\s+ROWS\s+ONLY\s*$/i);
    if (m) {
      const offset = parseInt(m[1], 10);
      const limit = parseInt(m[2], 10);
      const body = sql.slice(0, sql.length - m[0].length);
      // 先取前 offset+limit 行并编号，再滤掉前 offset 行
      return `SELECT * FROM (SELECT inner_.*, ROWNUM rn_ FROM ( ${body} ) inner_ WHERE ROWNUM <= ${offset + limit}) WHERE rn_ > ${offset}`;
    }

    // 仅限数：FETCH NEXT y ROWS ONLY
    m = sql.match(/\sFETCH\s+NEXT\s+(\d+)\s+ROWS\s+ONLY\s*$/i);
    if (m) {
      const limit = parseInt(m[1], 10);
      const body = sql.slice(0, sql.length - m[0].length);
      return `SELECT * FROM ( ${body} ) WHERE ROWNUM <= ${limit}`;
    }

    return sql;
  }

  console.error('[preload] Oracle 11g paging rewrite installed');
} catch (e) {
  console.error('[preload] 11g patch skipped:', e.message);
}

// ---------------------------------------------------------------
// tablesSchema 加速补丁：
// 原实现用 all_tab_columns × all_cons_columns × all_constraints 三表 JOIN，
// 在大 schema（3.6万列）上耗时 75s+，Playground 的 Data Model 表列表一直转圈。
// 改为：先快查列（~1.5s），再单独快查主键（~1s），合并出相同结构。
// ---------------------------------------------------------------
try {
  const driverMod = require('/cube/node_modules/@cubejs-backend/oracle-driver/driver/OracleDriver.js');
  const OD = driverMod.OracleDriver || driverMod;

  OD.prototype.tablesSchema = async function () {
    const cols = await this.query(`
      select tc.owner "table_schema"
           , tc.table_name "table_name"
           , tc.column_name "column_name"
           , tc.data_type "data_type"
      from all_tab_columns tc
      where tc.owner = user
    `);
    const pks = await this.query(`
      select cc.table_name "table_name", cc.column_name "column_name"
      from user_constraints c
      join user_cons_columns cc
        on c.constraint_name = cc.constraint_name and c.owner = cc.owner
      where c.constraint_type = 'P'
    `);
    const pkSet = new Set(pks.map(r => `${r.table_name}.${r.column_name}`));

    const unordered = {};
    for (const i of cols) {
      const s = (unordered[i.table_schema] = unordered[i.table_schema] || {});
      const t = (s[i.table_name] = s[i.table_name] || []);
      const attributes = pkSet.has(`${i.table_name}.${i.column_name}`) ? [['primaryKey']] : [];
      t.push({ name: i.column_name, type: i.data_type, attributes });
    }
    // 与原实现一致：schema 内表名排序、外层 schema 名排序
    const ordered = {};
    Object.keys(unordered).sort().forEach(k => {
      const tables = {};
      Object.keys(unordered[k]).sort().forEach(t2 => { tables[t2] = unordered[k][t2]; });
      ordered[k] = tables;
    });
    return ordered;
  };

  console.error('[preload] fast tablesSchema installed');
} catch (e) {
  console.error('[preload] tablesSchema patch skipped:', e.message);
}

// ---------------------------------------------------------------
// embed 看板补丁（docs/cube-dataqa-topic/15）：
// 拦 http.createServer，在 Cube 路由前认领 /cubejs-api/dashboards* 与 /embed/*
// 两个命名空间（固化写入 + 消费面），其余请求原样放行。业务代码在
// conf/embed/embed-patch.js，不与驱动补丁混。
// ---------------------------------------------------------------
try {
  require('/cube/conf/embed/embed-patch.js');
} catch (e) {
  console.error('[preload] embed patch skipped:', e.message);
}
