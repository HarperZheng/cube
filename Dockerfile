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

