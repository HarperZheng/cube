# Docker 网段冲突导致容器无法访问内网 Oracle —— 排查记录

- **日期**：2026-09-20
- **现象**：Cube 容器启动后停在 `http://localhost:4000/#/connection`，无法连接内网 Oracle `172.18.163.68:1521`
- **结果**：已解决，Oracle 实测登录成功，Playground HTTP 200

---

## 一、问题定位过程

### 1. 症状

容器内连 `172.18.163.68:1521` 报 `EHOSTUNREACH`（网络层直接不可达，不是 Oracle 拒绝）：

```bash
docker exec cube node -e "require('net').connect({host:'172.18.163.68',port:1521},...)"
# → TCP-ERR EHOSTUNREACH
```

但同一时刻，**宿主机 Windows 是通的**：

```bash
node -e "require('net').connect({host:'172.18.163.68',port:1521},s=>{console.log('TCP OK');s.end()}).on('error',e=>console.log('FAIL',e.code))"
# → TCP OK
```

宿主机通、容器不通 → 问题在 Docker 的网络层，而不是 Oracle 或防火墙。

### 2. 发现网段冲突

```bash
docker network inspect <网络名> --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

发现 Docker 之前创建的 compose 网络恰好分到了 **`172.18.0.0/16`**，而公司内网本身就占用 `172.18.0.0/16`（宿主机 IP `172.18.150.160`，Oracle 服务器 `172.18.163.68`）。容器发往内网的包被 Docker 认定为"自己的内部网络"，直接在网桥里找，根本不会路由出去。

### 3. 关键发现：残留网桥路由

把冲突网络 `docker compose down` 删掉后，问题**依旧**。在容器里查路由表：

```bash
docker exec cube cat /proc/net/route
```

看到（十六进制 `000012AC` = 小端 `AC 12 00 00` = `172.18.0.0`）：

```
Iface                 Destination  Gateway  Mask
br-c3616e2eee3c       000012AC     00000000  0000FFFF   ← 172.18.0.0/16 本地直连路由
```

**根因**：compose 网络虽然删过，但对应的**网桥接口 `br-xxx` 和这条本地路由一直残留在 Docker 虚拟机里**。容器去 `172.18.163.68` 的包仍被这条路由截走，永远出不了网。宿主机能连通是因为它不在这张路由表里。

> 注意：`docker compose down` 只删网络定义，**不清理**虚拟机里的网桥接口和路由，必须 `docker network prune`。

---

## 二、修复步骤

### 第 1 步：清理残留网络（关键）

```bash
docker network ls                # 找到残留的 cube_default / cube_cube-net
docker network prune -f          # 删除所有未被容器使用的网络及残留网桥
```

### 第 2 步：固定不冲突网段（防复发）

`docker-compose.yml` 中显式指定网段，避开公司内网：

```yaml
services:
  cube:
    ports:
      - 4000:4000
      - 15432:15432
    env_file:
      - .env
    volumes:
      - ./conf:/cube/conf
    networks:
      - cube-net

networks:
  cube-net:
    driver: bridge
    ipam:
      config:
        - subnet: 192.168.220.0/24   # 避开 172.18.0.0/16
```

### 第 3 步：重建容器

```bash
docker compose down
docker compose up -d
```

> 网络配置只有在容器**重建**时才生效，`docker compose restart` 不够。

---

## 三、验证

```bash
# 1. 容器内路由表不再有 172.18 劫持路由
docker exec cube cat /proc/net/route

# 2. TCP 连通（4ms 内返回）
docker exec cube node -e "require('net').connect({host:'172.18.163.68',port:1521},...)"

# 3. 真实驱动登录（Thick 模式，用 .env 里的账号）
docker exec cube node -e "...oracledb.getConnection({user:'YN0411',...,connectString:'172.18.163.68:1521/orcl'})"
# → ORACLE-LOGIN-OK

# 4. Playground 可访问
curl http://localhost:4000     # → HTTP 200
```

---

## 四、经验总结

| 坑 | 说明 |
|---|---|
| 公司内网占用 `172.18.0.0/16` | Docker 默认地址池从 172.17 依次分配，新网络很容易撞上 |
| 删了网络≠清了路由 | 必须用 `docker network prune` 清理残留网桥 |
| 宿主机通≠容器通 | 排查时要在**容器里** `cat /proc/net/route` 看真实路由 |
| 改网络配置要重建 | `restart` 不生效，需 `down` + `up -d` |
