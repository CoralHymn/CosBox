#!/usr/bin/env bash
#
# CosBox 数据同步服务一键安装脚本
# 用法（SSH 中执行其一）：
#   bash <(curl -fsSL https://download.benng.cc/cosbox/install.sh)
#   curl -fsSL https://download.benng.cc/cosbox/install.sh | bash
#
# 需要 root 权限与 Node.js >= 18；脚本会自动检测，缺失时在 Debian/Ubuntu 上尝试安装。
# 安装完成后会打印：服务器地址 + 同步密钥，把它们填进 CosBox「设置 → 数据同步」即可。
set -euo pipefail

BASE_URL="${COSBOX_DOWNLOAD_BASE:-https://download.benng.cc/cosbox}"
INSTALL_DIR="${COSBOX_SYNC_DIR:-/opt/cosbox-sync}"
PORT="${COSBOX_SYNC_PORT:-8787}"
SERVICE_NAME="cosbox-sync"

if [[ "$(id -u)" -ne 0 ]]; then
	echo "错误：请以 root 运行（sudo bash <(curl ...)）" >&2
	exit 1
fi

echo "==> 检查 Node.js ..."
if ! command -v node >/dev/null 2>&1; then
	echo "    未检测到 Node.js，尝试通过 NodeSource 安装（Debian/Ubuntu）..."
	if command -v apt-get >/dev/null 2>&1; then
		curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
		apt-get install -y nodejs
	else
		echo "错误：无法自动安装 Node.js，请先手动安装 Node.js >= 18（https://nodejs.org）后重试" >&2
		exit 1
	fi
fi

NODE_MAJOR="$(node -e 'console.log(Number(process.versions.node.split(".")[0]))')"
if [[ "${NODE_MAJOR}" -lt 18 ]]; then
	echo "错误：需要 Node.js >= 18，当前为 $(node -v)。请升级后重试。" >&2
	exit 1
fi

echo "==> 创建目录 ${INSTALL_DIR} ..."
mkdir -p "${INSTALL_DIR}/data"

echo "==> 下载服务端 index.mjs ..."
curl -fsSL "${BASE_URL}/index.mjs" -o "${INSTALL_DIR}/index.mjs"
chmod 755 "${INSTALL_DIR}/index.mjs"

echo "==> 生成同步密钥 ..."
KEY_FILE="${INSTALL_DIR}/data/key.txt"
if [[ ! -s "${KEY_FILE}" ]]; then
	KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
	printf '%s\n' "${KEY}" > "${KEY_FILE}"
	chmod 600 "${KEY_FILE}"
else
	KEY="$(tr -d '\n' < "${KEY_FILE}")"
	echo "    检测到已有密钥，保留原密钥。"
fi

echo "==> 写入 systemd 服务 ..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=CosBox data sync server
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/env node ${INSTALL_DIR}/index.mjs
Environment=COSBOX_SYNC_PORT=${PORT}
Environment=COSBOX_SYNC_DATA=${INSTALL_DIR}/data
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
systemctl restart "${SERVICE_NAME}"

echo "==> 探测服务器地址 ..."
PUBLIC_IP="$(curl -fsSL -m 5 https://ifconfig.me 2>/dev/null || true)"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

echo ""
echo "================================================================"
echo "  CosBox 同步服务安装完成"
echo "================================================================"
echo ""
echo "  服务状态：$(systemctl is-active ${SERVICE_NAME})"
echo ""
if [[ -n "${PUBLIC_IP}" ]]; then
	echo "  公网地址：http://${PUBLIC_IP}:${PORT}"
	echo "  （建议配置 HTTPS 反向代理后使用 https:// 地址，见 server/README.md）"
fi
if [[ -n "${LAN_IP}" ]]; then
	echo "  内网地址：http://${LAN_IP}:${PORT}"
fi
echo "  同步密钥：${KEY}"
echo ""
echo "  在 CosBox「设置 → 数据同步」中填写："
echo "    服务器地址：http://<上面任一地址>:${PORT}"
echo "    服务器密钥：${KEY}"
echo ""
echo "  其他："
echo "    - 防火墙放行：ufw allow ${PORT}/tcp  （或云厂商安全组放行）"
echo "    - 卸载：systemctl disable --now ${SERVICE_NAME} && rm -rf ${INSTALL_DIR}"
echo "    - 查看日志：journalctl -u ${SERVICE_NAME} -f"
echo "================================================================"
