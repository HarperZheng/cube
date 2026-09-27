# Cube + Oracle 11g 项目搭建与二次开发执行说明

> 本文档合并两部分内容：
> - **第一部分：基础环境搭建**——从零在 Windows 上跑通「Cube（Docker）+ Oracle 11g」（当前已跑通，作为现状记录）；
> - **第二部分：二次开发执行说明**——复用现有镜像 + 挂载源码仓 + `yarn link` 覆盖，便于修改 Cube 源码（跨 Windows / Ubuntu 迁移）。
>
> 更新日期：2026-09-21。

---

## 第一部分：基础环境搭建（Windows，已跑通）

### 1.1 目录结构（现状）

```
D:\develop\cube\
├── docker-compose.yml        # 服务编排（固定网段 192.168.220.0/24）
├── Dockerfile                # 基于 cubejs/cube，加装 Oracle Client + Python 依赖
├── preload.js                # NODE_OPTIONS 预加载：oracledb 强制 THICK 模式
├── .env                      # Oracle 连接配置
├── requirements.txt          # Python 动态模型依赖（oracledb）
├── conf\                     # 挂载到 /cube/conf
│   └── model\
│       ├── globals.py        # Jinja/TemplateContext 辅助函数
│       ├── cubes\            # cube 模型（bill_kpi.yml、facts_* 等）
│       └── views\            # view 模型
├── agent\                    # 挂载到 /cube/agent（cube.js、db.js）
├── regress\                  # 回归查询与基线（*_queries.json / *_baseline.json）
└── docs\                     # 阅读成果与本文档
```

### 1.2 前置检查

1. **Docker Desktop 已在运行**（托盘鲸鱼图标稳定）。验证：
   ```powershell
   docker info
   ```
2. **确认 Oracle 版本 ≥ 11.2.0.3**（Instant Client 19c 的下限，否则 Thick 模式也连不上）：
   ```sql
   select version from product_component_version;
   ```
3. 确认 Oracle 装在哪里：内网服务器 `172.18.163.68:1521`（当前 `.env` 即此配置）。

### 1.3 关键文件（当前版本）

**`Dockerfile`**（要点：Instant Client 19.32 + libaio1t64 兼容 + pip/oracledb + preload 注入）：

```dockerfile
FROM cubejs/cube

USER root
RUN apt-get update \
 && apt-get install -y wget unzip \
 && (apt-get install -y libaio1t64 || apt-get install -y libaio1) \
 && ( [ -e /usr/lib/x86_64-linux-gnu/libaio.so.1t64 ] && ln -sf /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1 || true ) \
 && rm -rf /var/lib/apt/lists/*

RUN wget -L https://download.oracle.com/otn_software/linux/instantclient/1932000/instantclient-basiclite-linux.x64-19.32.0.0.0dbru.zip -O /tmp/ic.zip \
 && unzip -o /tmp/ic.zip -d /opt \
 && rm /tmp/ic.zip \
 && ln -s /opt/instantclient_* /opt/oracle-client \
 && echo /opt/oracle-client > /etc/ld.so.conf.d/oracle-instantclient.conf \
 && ldconfig

ENV LD_LIBRARY_PATH=/opt/oracle-client
ENV ORACLE_CLIENT_LIB_DIR=/opt/oracle-client

# —— Python 动态数据模型依赖（conf/model/globals.py 所需）——
# 基础镜像无 pip 且不会自动安装 requirements.txt，依赖在此固化。
# cube 模块由 Cube 原生扩展内置提供（from cube import TemplateContext），
# 不能 pip 安装 PyPI 的 cube 包（是无关包，会遮蔽内置模块）
RUN wget -qO /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py \
 && python3 /tmp/get-pip.py --break-system-packages \
 && pip3 install --break-system-packages --no-cache-dir oracledb \
 && rm -f /tmp/get-pip.py

RUN ORA_NM=$(dirname $(find / -type d -name oracledb -path '*node_modules*' 2>/dev/null | head -1)) \
 && echo "NODE_PATH=${ORA_NM}" >> /etc/environment

COPY preload.js /preload.js
ENV NODE_OPTIONS="--require /preload.js"
```

**`preload.js`**（oracledb 强制 THICK 模式，连 11g 必须）：

```js
const oracledb = require('oracledb');
try {
  oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR || '/opt/oracle-client' });
  console.log('[preload] oracledb forced to THICK mode');
} catch (e) {
  if (!/already initialized/i.test(e.message)) throw e;
}
```

**`docker-compose.yml`**（固定网段：公司内网占用 172.18.0.0/16，Docker 默认网段若与其冲突，容器将无法访问内网 Oracle）：

```yaml
services:
  cube:
    build: .
    image: cube-oracle:local
    container_name: cube
    ports:
      - 4000:4000      # Playground / REST API
      - 15432:15432    # SQL API
    env_file:
      - .env
    environment:
      - CUBEJS_DEV_MODE=true
    volumes:
      - ./conf:/cube/conf
      - ./preload.js:/preload.js
      - ./agent:/cube/agent
    networks:
      - cube-net

networks:
  cube-net:
    driver: bridge
    ipam:
      config:
        - subnet: 192.168.220.0/24
```

**`.env`**：

```env
CUBEJS_DB_HOST=172.18.163.68   # 远程内网服务器，保持原样
CUBEJS_DB_PORT=1521
CUBEJS_DB_NAME=orcl            # service name，不是 SID
CUBEJS_DB_USER=YN0411
CUBEJS_DB_PASS=Bstdb@2021#
CUBEJS_DB_TYPE=oracle
CUBEJS_DEV_MODE=true
```

### 1.4 构建与启动

```powershell
cd D:\develop\cube
docker compose build     # 首次：拉基础镜像 + Instant Client + pip 依赖，几分钟
docker compose up -d
docker logs cube -f      # 看到 [preload] oracledb forced to THICK mode 即生效
```

### 1.5 验证

- 浏览器打开 `http://localhost:4000` → 数据源已在 `.env` 配好，**直接进入模型页**；
- `http://localhost:4000/#/build` → Playground 查询验证（bill_kpi 等）；
- `http://localhost:4000/#/schema` → 浏览数据模型。

### 1.6 常见排错

| 现象 | 原因与处理 |
| --- | --- |
| `docker: error during connect` | Docker Desktop 没运行 |
| `DPI-1047` / 找不到 Oracle Client 库 | Instant Client 没装进镜像；`docker compose build --no-cache` 重来 |
| `ORA-12170` connect timeout | 主机地址错；内网库用 `172.18.163.68`，本机库才用 `host.docker.internal` |
| `ORA-12514` | `CUBEJS_DB_NAME` 应是 service name（orcl），不是 SID |
| `require('oracledb')` 找不到 | `NODE_PATH` 没解析到；检查镜像内 oracledb 路径与 `find` 结果是否一致 |
| Instant Client 下载 404 | 链接可能更新，去 Oracle 官网确认最新 19c basiclite zip 地址 |
| `ORA-12154` 等 TNS 错误 | 确认容器网络能到内网：`docker exec cube ping 172.18.163.68` |

> ⚠️ 这是**非官方 workaround**（强制 Thick 模式连 11g）。Cube 升级改了驱动初始化时可能失效，需复核。

---

## 第二部分：二次开发执行说明（复用镜像 + 源码挂载 + yarn link）

### 2.1 原理：为什么能复用镜像

对运行中的镜像 `cube-oracle:local` 实测验证（2026-09-21）：

| 镜像内事实 | 意义 |
| --- | --- |
| Node **v24.21.0** = 源码仓 `.nvmrc` | 源码版本完全匹配 |
| 服务代码装在 `/cube/node_modules`，版本 **1.7.42** = 仓库最新 tag `v1.7.42` | 源码仓 clone 到该 tag 即版本对齐 |
| `/cube/package.json.local` 内含官方 `link:dev` 脚本（列出全部可 link 的包） | **官方设计就是用 `yarn link` 把自己构建的包换进运行时** |
| 镜像内有 `/usr/local/bin/yarn` | 容器内直接构建源码，宿主机无需任何工具链 |
| native（含 Python 桥）、Oracle Client、oracledb 固化在镜像里 | globals.py 照常工作，**无需自编 Rust** |
| 镜像 OS/架构：**linux / amd64**（Debian 13） | Windows（Docker Desktop = WSL2 后端跑 Linux 容器）与 Ubuntu 通用 |

结论：**镜像不动，源码挂载进去，改哪个包就 `yarn link` 哪个包**——未 link 的包继续用镜像预编译版本，native / Python 桥 / 驱动全部不受影响。

### 2.2 目录布局（在现有目录上加一个 cube-repo）

```
D:\develop\cube\
├── docker-compose.yml      # 只加一行 volume
├── Dockerfile  preload.js  .env  conf\  agent\   # 照旧，全部不动
└── cube-repo\              # git clone 的源码仓（锁定 v1.7.42），二开改动都在这
```

```yaml
# docker-compose.yml 只需在 volumes 增加：
    volumes:
      - ./conf:/cube/conf
      - ./preload.js:/preload.js
      - ./agent:/cube/agent
      - ./cube-repo:/cube-build    # 源码仓挂载（/cube-build 是镜像构建时的原始路径名）
```

### 2.3 执行步骤

**① 克隆源码（锁定与镜像一致的版本）**

```powershell
cd D:\develop\cube
git clone --depth 1 --branch v1.7.42 https://github.com/cube-js/cube.git cube-repo
```

**② 一次性初始化：容器内构建**（在 Linux 容器里做，保证产物跨 OS 兼容）

```powershell
docker compose run --rm cube sh -c "cd /cube-build && yarn install && yarn tsc"
```

> 首次较久（安装全部 workspace 依赖）。**不要在 Windows 宿主机上 `yarn install`**——Windows 产物进 Linux 容器不兼容。

**③ 日常二开循环**：改 `/cube-build/packages/<某包>` 源码 → 重建该包 → link 进运行时 → 重启：

```powershell
# 例：修改 schema-compiler
docker compose run --rm cube sh -c "cd /cube-build/packages/cubejs-schema-compiler && yarn build && yarn link"
docker compose run --rm cube sh -c "cd /cube && yarn link @cubejs-backend/schema-compiler"
docker compose restart cube
```

- 改几个包就 link 几个；镜像 `/cube/package.json.local` 的 `link:dev` 脚本列了全套包名（server、server-core、api-gateway、schema-compiler、query-orchestrator、client-core、playground 等），可参考。
- link 只需做一次；之后每次改码只需**重建该包 + `docker compose restart`**。
- 取消覆盖：`docker compose run --rm cube sh -c "cd /cube && yarn unlink @cubejs-backend/<包名> && yarn install --check-files"`。

**④ 验证**

```powershell
docker compose restart cube
docker logs cube -f
# 浏览器 http://localhost:4000/#/build 重跑 regress\*_queries.json 里的查询，
# 结果应与 regress\*_baseline.json 基线一致
```

### 2.4 什么时候才需要更重的方案

只有当二开深入到**改启动链本身**（server 启动逻辑、gateway 装配）时，才考虑整个源码挂载 + `command` 覆盖从源码启动——那时才需要处理 Python feature 自编（Rust 工具链）。日常改 schema-compiler、api-gateway、playground 等包，包级 link 完全够。

---

## 第三部分：跨操作系统迁移（Windows ↔ Ubuntu）

### 3.1 三条铁律

1. **`node_modules` 必须在 Linux 容器内构建**（第 2.3 步②），绝不要在 Windows 宿主机上 `yarn install`。容器内构建一次，产物落在 `cube-repo\` 里，两边通用。
2. **compose 全部用相对路径挂载**，同一份文件拷到 Ubuntu 无需任何修改；固定网段 `192.168.220.0/24` 注释同样保留（Ubuntu 上 Docker 默认网段也可能踩 172.18 冲突）。
3. **迁移的边界只在 Docker 引擎一层**：Windows = Docker Desktop（WSL2 后端），Ubuntu = 原生 Docker Engine；镜像、compose、挂载代码三者通用。

### 3.2 迁移步骤

**方式一：导出镜像直接搬（推荐，保证两端完全一致）**

```powershell
# Windows 侧导出
docker save cube-oracle:local -o cube-oracle-local.tar
# 拷贝整个 D:\develop\cube 目录 + cube-oracle-local.tar 到 Ubuntu

# Ubuntu 侧导入并启动
docker load -i cube-oracle-local.tar
cd ~/cube && docker compose up -d
```

**方式二：Ubuntu 上重新构建**（Dockerfile + 源码都在，网络通即可）

```bash
cd ~/cube
docker compose build && docker compose up -d
docker compose run --rm cube sh -c "cd /cube-build && yarn install && yarn tsc"   # 源码仓重新构建
```

### 3.3 平台限制

- 当前镜像为 **linux/amd64**：Windows / Ubuntu x86_64 均可直接用；
- 若目标机为 **ARM**（Apple Silicon、ARM 服务器）：native 二进制与 Oracle Instant Client 都要换 arm64 版本重新构建镜像，源码步骤不变。

---

## 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `docker compose up -d` | 后台启动整套服务 |
| `docker compose down` | 停止并删除容器和网络 |
| `docker compose restart` | 只重启容器（不会应用 compose 文件的新配置，改了配置要 `down` + `up`） |
| `docker compose build` | 重新构建镜像 |
| `docker logs cube -f` | 跟踪容器日志 |
| `docker compose run --rm cube sh -c "..."` | 在容器内执行一次性命令（源码构建 / link） |
| `docker exec cube ping 172.18.163.68` | 验证容器到内网 Oracle 的连通性 |
