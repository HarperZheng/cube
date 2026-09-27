#!/usr/bin/env node
/**
 * db.js —— 直连原始数据库（Oracle）探索工具，在 cube 容器内运行
 * （oracledb thick 模式 + .env 连接配置）
 *
 * 用法（在 cube 容器内运行，宿主机无需 Node；Git Bash 下用 sh -c 包一层防路径改写）：
 *   docker exec cube sh -c "node /cube/agent/db.js tables [名称过滤]"
 *   docker exec cube sh -c "node /cube/agent/db.js cols <表名>"
 *   docker exec cube sh -c "node /cube/agent/db.js find <关键字>"
 *   docker exec cube sh -c "node /cube/agent/db.js count <表名>"
 *   docker exec cube sh -c "node /cube/agent/db.js sql '<select语句>'"
 *
 * 核实命令（docs/cube-dataqa-topic/09 建模总结"核实六件事"的标准动作）：
 *   dist <表名> <列名> [日期列]    口径分布：取值分布+空值数+日期范围（核实第3步）
 *   matchkey <表.列> <参照表.列>   join 键匹配率：total/miss/匹配率%（核实第4步）
 *   grain <明细表> <外键> <主表> <主键>  粒度核实：明细/外键/主表/孤儿（核实第5步）
 *   fam <前缀> [排除关键词...]     家族批量行数（核实第1步存在性普查）
 * （以上均加前缀 docker exec cube sh -c "node /cube/agent/db.js"）
 *
 * 示例：
 *   ... db.js dist FBE_SUSPICIOUS FRESULT FDATE
 *   ... db.js matchkey FBE_SUSPICIOUS.FAGENIDCODE FAB_AGEN.FAGENIDCODE
 *   ... db.js grain UBE_STOCK_APPLY_ITEM FPID UBE_STOCK_APPLY FID
 *   ... db.js fam UBE_STOCK
 */
'use strict';
const oracledb = require('oracledb');

// 标识符安全引用（表名/列名不能绑定参数，先大写再双引号包裹）
const q = (id) => JSON.stringify(String(id || '').toUpperCase());

// ③④ 共享实现：join 键匹配统计（not exists 模板，一份维护、两命令同时生效）
async function matchStats(conn, fkTable, fkCol, pkTable, pkCol) {
  const sql = `select count(*) as total,
    sum(case when not exists (
      select 1 from ${q(pkTable)} p where p.${q(pkCol)} = f.${q(fkCol)}
    ) then 1 else 0 end) as miss
    from ${q(fkTable)} f where f.${q(fkCol)} is not null`;
  const r = await conn.execute(sql, [], { maxRows: 10 });
  const total = r.rows[0][0] || 0;
  const miss = r.rows[0][1] || 0;
  const rate = total ? ((total - miss) / total * 100).toFixed(2) + '%' : '-';
  return { total, miss, rate };
}

async function main() {
  oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR || '/opt/oracle-client' });
  const conn = await oracledb.getConnection({
    user: process.env.CUBEJS_DB_USER,
    password: process.env.CUBEJS_DB_PASS,
    connectString: `${process.env.CUBEJS_DB_HOST}:${process.env.CUBEJS_DB_PORT}/${process.env.CUBEJS_DB_NAME}`,
  });

  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'tables': {
        const like = rest[0] ? `and t.table_name like '%${rest[0].toUpperCase()}%'` : '';
        const r = await conn.execute(
          `select t.table_name, c.comments from user_tables t
           left join user_tab_comments c on c.table_name = t.table_name
           where 1=1 ${like} order by t.table_name`, [], { maxRows: 2000 });
        r.rows.forEach((x) => console.log(`${x[0]}  =  ${x[1] || ''}`));
        console.log(`(${r.rows.length} 张表)`);
        break;
      }

      case 'cols': {
        const r = await conn.execute(
          `select col.column_name, col.data_type, col.data_length, com.comments
           from user_tab_columns col
           left join user_col_comments com
             on col.table_name = com.table_name and col.column_name = com.column_name
           where col.table_name = :t order by col.column_id`,
          { t: rest[0].toUpperCase() });
        if (!r.rows.length) { console.log(`表不存在或无列: ${rest[0]}`); break; }
        r.rows.forEach((x) => console.log(`${x[0]}  ${x[1]}(${x[2]})  =  ${x[3] || ''}`));
        console.log(`(${r.rows.length} 列)`);
        break;
      }

      case 'find': {
        const kw = `%${rest[0]}%`;
        const r = await conn.execute(
          `select col.table_name, col.column_name, com.comments
           from user_tab_columns col
           left join user_col_comments com
             on col.table_name = com.table_name and col.column_name = com.column_name
           where (col.column_name like :kw or com.comments like :kw)
             and rownum <= 80 order by col.table_name, col.column_name`,
          { kw });
        r.rows.forEach((x) => console.log(`${x[0]}.${x[1]}  =  ${x[2] || ''}`));
        console.log(`(${r.rows.length} 个字段${r.rows.length >= 80 ? '，已截断' : ''})`);
        break;
      }

      case 'count': {
        const r = await conn.execute(`select count(*) from ${JSON.stringify(rest[0].toUpperCase())}`);
        console.log(`${rest[0]}: ${r.rows[0][0]} 行`);
        break;
      }

      case 'sql': {
        const r = await conn.execute(rest[0], [], { maxRows: 1000 });
        if (!r.rows.length) { console.log('(0 行)'); break; }
        const cols = r.metaData.map((m) => m.name);
        console.log(cols.join(' | '));
        r.rows.slice(0, 100).forEach((row) => console.log(row.map((v) => (v === null ? 'null' : String(v))).join(' | ')));
        console.log(`(${r.rows.length} 行${r.rows.length > 100 ? '，显示前100' : ''})`);
        break;
      }

      // ② 口径分布（核实第 3 步）
      case 'dist': {
        const [table, col, dateCol] = rest;
        if (!table || !col) { console.log('用法: dist <表名> <列名> [日期列]'); break; }
        const withDate = dateCol ? `, min(${q(dateCol)}) as mn, max(${q(dateCol)}) as mx` : '';
        const r = await conn.execute(
          `select ${q(col)} as val, count(*) as cnt,
             sum(case when ${q(col)} is null then 1 else 0 end) as null_cnt${withDate}
           from ${q(table)} group by ${q(col)} order by 1`, [], { maxRows: 1000 });
        if (!r.rows.length) { console.log('(0 行)'); break; }
        r.rows.forEach((x) => console.log(
          `${x[0] === null ? 'null' : x[0]}  |  ${x[1]} 行  |  null ${x[2]}${dateCol ? `  |  ${x[3]} ~ ${x[4]}` : ''}`));
        console.log(`(${r.rows.length} 个取值${r.rows.length >= 1000 ? '，已截断' : ''})`);
        break;
      }

      // ③ join 键匹配率（核实第 4 步）
      case 'matchkey': {
        const parts = rest.map((s) => String(s || '').split('.'));
        if (!parts[0] || !parts[1] || !parts[0][1] || !parts[1][1]) {
          console.log('用法: matchkey <表.列> <参照表.列>');
          break;
        }
        const s = await matchStats(conn, parts[0][0], parts[0][1], parts[1][0], parts[1][1]);
        console.log(`${parts[0][0].toUpperCase()}.${parts[0][1].toUpperCase()} -> ${parts[1][0].toUpperCase()}.${parts[1][1].toUpperCase()}`);
        console.log(`total（非空行）: ${s.total}`);
        console.log(`miss（匹配不上）: ${s.miss}`);
        console.log(`匹配率: ${s.rate}`);
        break;
      }

      // ④ 粒度核实（核实第 5 步，孤儿数取自 matchStats 同一份实现）
      case 'grain': {
        const [detail, fk, master, pk] = rest;
        if (!detail || !fk || !master || !pk) {
          console.log('用法: grain <明细表> <外键> <主表> <主键>');
          break;
        }
        const s = await matchStats(conn, detail, fk, master, pk);
        const r1 = await conn.execute(
          `select count(*) as c, count(distinct ${q(fk)}) as d,
             sum(case when ${q(fk)} is null then 1 else 0 end) as n
           from ${q(detail)}`, [], { maxRows: 10 });
        const r2 = await conn.execute(`select count(*) from ${q(master)}`, [], { maxRows: 10 });
        console.log(`明细行数: ${r1.rows[0][0]}`);
        console.log(`distinct 外键数: ${r1.rows[0][1]}`);
        console.log(`主表行数: ${r2.rows[0][0]}`);
        console.log(`孤儿数（引用不存在的主表行）: ${s.miss}`);
        console.log(`null 外键数（孤儿数不含它们，同样 join 不上主表属性）: ${r1.rows[0][2]}`);
        console.log(`(明细行数 ≥ 主表行数，两边 count 不能直接比大小；孤儿行下钻时 join 主表属性为 null)`);
        break;
      }

      // ⑤ 家族批量行数（核实第 1 步存在性普查，一条命令替代逐表 count）
      case 'fam': {
        const prefix = (rest[0] || '').toUpperCase();
        if (!prefix) { console.log('用法: fam <前缀> [排除关键词...]'); break; }
        const excludes = rest.slice(1).map((x) => String(x).toUpperCase());
        const r = await conn.execute(
          'select table_name from user_tables where table_name like :p order by table_name',
          { p: prefix + '%' }, { maxRows: 500 });
        const names = r.rows.map((x) => x[0]).filter((n) => !excludes.some((e) => n.includes(e)));
        if (!names.length) { console.log('(0 张表)'); break; }
        // 表名作为常量列须用单引号字面量（q() 的双引号在 select 列表里是标识符引用，ORA-00904）
        const sql = names.map((n) => `select '${n.replace(/'/g, "''")}' as t, count(*) as c from ${q(n)}`).join(' union all ');
        const rc = await conn.execute(sql, [], { maxRows: 500 });
        rc.rows.forEach((x) => console.log(`${x[0]}  =  ${x[1]} 行`));
        console.log(`(${rc.rows.length} 张表)`);
        break;
      }

      default:
        console.log(fs_usage());
    }
  } finally {
    await conn.close();
  }
}

function fs_usage() {
  return [
    '用法:',
    '  tables [过滤]   列出表（含注释）',
    '  cols <表名>     表的列+类型+注释',
    '  find <关键字>   按列名/注释搜字段',
    '  count <表名>    行数',
    '  sql "<select>"  原始查询',
    '核实命令（09 建模总结"核实六件事"）:',
    '  dist <表> <列> [日期列]              口径分布：取值+空值+日期范围',
    '  matchkey <表.列> <参照表.列>         join 键匹配率：total/miss/匹配率%',
    '  grain <明细表> <外键> <主表> <主键>  粒度核实：明细/外键/主表/孤儿',
    '  fam <前缀> [排除关键词...]           家族批量行数',
  ].join('\n');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
