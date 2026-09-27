# -*- coding: utf-8 -*-
# Cube 动态数据模型 Python 上下文（docs: data-modeling/dynamic/jinja）
# 位置约定：model/globals.py（Cube 服务端硬约束：按 fileName === 'globals.py'
# 从 schema 根查找，必须在此；容器内 /cube/conf/model/globals.py）
# 依赖：oracledb（已固化进 Dockerfile 的 python 依赖层）
import os

import oracledb
from cube import TemplateContext

template = TemplateContext()

# Oracle 11g 服务端：python-oracledb thin 模式仅支持 12.1+，必须 thick 模式
# （Instant Client 19.32 已在镜像内，与 preload.js 的 Node 侧 thick 模式同一原因）
# 注意 python-oracledb 26.x 用 snake_case：init_oracle_client(lib_dir=...)
try:
    oracledb.init_oracle_client(
        lib_dir=os.environ.get('ORACLE_CLIENT_LIB_DIR', '/opt/oracle-client'))
except Exception as e:  # 每进程只允许初始化一次；重复调用属正常
    if 'already initialized' not in str(e).lower():
        raise


@template.function('monthly_tables')
def monthly_tables(prefix):
    """编译期枚举按月分表 <PREFIX>_YYYYMM（P3 泛化：前缀作参数，cbill/cbill_item 共用）。

    正则限定 6 位数字后缀，排除干扰表（UNE_CBILL 家族实测）：
    - 主表 <PREFIX>（无后缀）、备份 _BACK2/_BACK3040、临时 _TMP/_TEMP/_DAY_TMP
    - 按日分表 _YYYYMMDD（8 位，如 UNE_CBILL_ITEM_20260807、UNE_CBILL_20250307）
    - 年表 _YYYY（4 位，如 UNE_CBILL_2019）、扩展表 _EXT_YYYY
    并按 `后缀月份 <= 当前月` 过滤未来空表（如 202610-202612）——UNION 空分支
    纯属扫描浪费；历史空月（如 UNE_CBILL_202301）保留，行为稳定。
    返回按月排序的表名列表，如 ['UNE_CBILL_202302', ...]。
    """
    import datetime
    ym_now = datetime.date.today().strftime('%Y%m')
    conn = oracledb.connect(
        user=os.environ['CUBEJS_DB_USER'],
        password=os.environ['CUBEJS_DB_PASS'],
        dsn='{0}:{1}/{2}'.format(
            os.environ['CUBEJS_DB_HOST'],
            os.environ['CUBEJS_DB_PORT'],
            os.environ['CUBEJS_DB_NAME'],
        ),
    )
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                'select table_name from user_tables'
                " where regexp_like(table_name, '^{0}_[0-9]{{6}}$')"
                ' order by table_name'.format(prefix)
            )
            rows = cur.fetchall()
        finally:
            cur.close()
        # 未来空表过滤：后缀月份 > 当前月的排除（新月份到点自动纳入）
        return [r[0] for r in rows if r[0][-6:] <= ym_now]
    finally:
        conn.close()


@template.function('monthly_columns')
def monthly_columns(prefix):
    """编译期返回所有有效月表 <PREFIX>_YYYYMM 的列交集（P3 实测新增）。

    动态 UNION 不能用 SELECT t.*：不同月份建的表列集不同（cbill 月表实测
    104/105/106 列不齐——2025 年起加 FTEMPLATEID、202512 再加 FDONATETYPE），
    UNION ALL 列数不一致报 ORA-01789。本函数取"每个有效月表都有的列"
    （having count(distinct table_name) = 有效表数），UNION 按列名显式展开，
    新月表多出的列自动被排除，少列/改列名会导致编译期报错（fail loud）。
    有效表范围与 monthly_tables 一致（正则 6 位后缀 + 未来空表过滤）。
    返回按 column_id 排序的列名列表（与建表列序一致）。
    """
    import datetime
    ym_now = datetime.date.today().strftime('%Y%m')
    conn = oracledb.connect(
        user=os.environ['CUBEJS_DB_USER'],
        password=os.environ['CUBEJS_DB_PASS'],
        dsn='{0}:{1}/{2}'.format(
            os.environ['CUBEJS_DB_HOST'],
            os.environ['CUBEJS_DB_PORT'],
            os.environ['CUBEJS_DB_NAME'],
        ),
    )
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                'select column_name from user_tab_columns'
                " where regexp_like(table_name, '^{0}_[0-9]{{6}}$')"
                " and table_name <= '{0}_' || :ym"
                ' group by column_name'
                ' having count(distinct table_name) = ('
                '  select count(distinct table_name) from user_tab_columns'
                "  where regexp_like(table_name, '^{0}_[0-9]{{6}}$')"
                "  and table_name <= '{0}_' || :ym)"
                ' order by min(column_id)'.format(prefix),
                ym=ym_now,
            )
            rows = cur.fetchall()
        finally:
            cur.close()
        return [r[0] for r in rows]
    finally:
        conn.close()
