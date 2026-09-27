#!/bin/sh
# 升级镜像后重新生成 index.html 副本（docs/cube-dataqa-topic/08 第五节）：
# 从镜像（不带挂载的临时容器）拉原版 index.html → 幂等注入 ext-drill.js 引用。
# 用临时容器而非 docker exec：挂载生效后 exec 读到的是旧副本，会错过新版本。
set -e
cd "$(dirname "$0")"

IMAGE=${1:-cube-oracle:local}
TARGET=/cube/node_modules/@cubejs-backend/server-core/playground/index.html

docker create --name ext-drill-sync-tmp "$IMAGE" >/dev/null
docker cp ext-drill-sync-tmp:$TARGET index.html.new
docker rm ext-drill-sync-tmp >/dev/null

if grep -q 'ext-drill\.js' index.html.new; then
  echo "副本已含 ext-drill.js 引用"
else
  sed -i 's#</body>#<script src="/ext-drill.js"></script></body>#' index.html.new
  echo "已注入 ext-drill.js 引用"
fi

if grep -q 'ext-chat\.js' index.html.new; then
  echo "副本已含 ext-chat.js 引用"
else
  sed -i 's#</body>#<script src="/ext-chat.js"></script></body>#' index.html.new
  echo "已注入 ext-chat.js 引用"
fi
mv index.html.new index.html
echo "index.html 副本已更新，执行 docker compose up -d 重建容器生效"
