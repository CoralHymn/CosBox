# CosBox 数据同步服务器

零依赖 Node.js 服务端，为 CosBox 提供**实时数据同步**：快照/世界配置/世界书/
角色档案/开发者开关会同步到服务器（**不含模型配置与 API Key**）。

- 服务端文件：`index.mjs`（Node >= 18，无第三方依赖）
- 一键安装：`install.sh`
- 下载：<https://download.benng.cc/cosbox/>

---

## 一、一键安装（推荐，类似宝塔）

在服务器 SSH 中执行（需要 root）：

```bash
bash <(curl -fsSL https://download.benng.cc/cosbox/install.sh)
```

或：

```bash
curl -fsSL https://download.benng.cc/cosbox/install.sh | bash
```

脚本会：

1. 检测 Node.js >= 18（Debian/Ubuntu 缺失时自动通过 NodeSource 安装）；
2. 下载 `index.mjs` 到 `/opt/cosbox-sync`；
3. 生成 32 字节随机**同步密钥**（存于 `data/key.txt`，权限 600）；
4. 注册并启动 systemd 服务 `cosbox-sync`（开机自启）；
5. 探测公网/内网 IP，打印设置所需内容：

```
  公网地址：http://1.2.3.4:8787
  内网地址：http://192.168.1.10:8787
  同步密钥：<64 位十六进制>
```

然后把「服务器地址 + 同步密钥」填进 CosBox **设置 → 数据同步**，启用即可。

> 放行端口：`ufw allow 8787/tcp`，或到云厂商安全组放行 8787。

---

## 二、手动安装（不想用一键脚本 / 面板安装）

### 1. 安装 Node.js >= 18

- Debian/Ubuntu：
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ```
- 其他系统：到 <https://nodejs.org> 下载，或用系统包管理器安装。
- 宝塔/面板：在「软件商店」安装 Node.js 版本管理器并选择 >= 18 的版本。

### 2. 下载服务端文件

```bash
mkdir -p /opt/cosbox-sync/data
cd /opt/cosbox-sync
curl -fsSL https://download.benng.cc/cosbox/index.mjs -o index.mjs
chmod 755 index.mjs
```

（面板用户也可直接下载 `index.mjs` 上传到任意目录。）

### 3. 准备密钥（二选一）

**方式 A：自动生成（推荐）**——首次启动时自动生成并写入 `data/key.txt`，
启动日志会打印密钥：

```bash
cd /opt/cosbox-sync
node index.mjs
```

记下日志里的 `同步密钥：xxxx`，然后 Ctrl+C 退出，后续用 systemd 托管。

**方式 B：手动指定**：

```bash
cd /opt/cosbox-sync
printf '%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > data/key.txt
chmod 600 data/key.txt
```

### 4. 配置 systemd（可选但推荐，开机自启）

创建 `/etc/systemd/system/cosbox-sync.service`：

```ini
[Unit]
Description=CosBox data sync server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cosbox-sync
ExecStart=/usr/bin/env node /opt/cosbox-sync/index.mjs
Environment=COSBOX_SYNC_PORT=8787
Environment=COSBOX_SYNC_DATA=/opt/cosbox-sync/data
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now cosbox-sync
journalctl -u cosbox-sync -f   # 查看日志
```

### 5. 环境变量

| 变量               | 说明                     | 默认              |
| ------------------ | ------------------------ | ----------------- |
| `COSBOX_SYNC_PORT` | 监听端口                 | `8787`            |
| `COSBOX_SYNC_DATA` | 数据目录                 | `<脚本目录>/data` |
| `COSBOX_SYNC_KEY`  | 显式密钥（覆盖 key.txt） | 读取/生成 key.txt |

---

## 三、HTTPS（强烈建议，确保传输安全）

同步密钥已保证「谁有密钥谁能读写」，但为防中间人窃听，公网使用请务必套 HTTPS。
用 **Caddy**（自动证书，最简单）或 **Nginx** 反代到 8787：

### Caddy

`/etc/caddy/Caddyfile`：

```
sync.example.com {
	reverse_proxy 127.0.0.1:8787
}
```

### Nginx

```nginx
server {
	server_name sync.example.com;
	listen 443 ssl;
	# 配置 ssl_certificate / ssl_certificate_key（如 Let's Encrypt）
	location / {
		proxy_pass http://127.0.0.1:8787;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
	}
}
```

之后 CosBox 填写的服务器地址用 `https://sync.example.com` 即可。

---

## 四、API 说明

| 方法 | 路径             | 鉴权        | 说明                                                  |
| ---- | ---------------- | ----------- | ----------------------------------------------------- |
| GET  | `/api/health`    | 无          | 连接测试                                              |
| GET  | `/api/workspace` | Bearer 密钥 | 读取最近一次同步数据（`{data, updatedAt}` 或 `null`） |
| PUT  | `/api/workspace` | Bearer 密钥 | 写入同步数据（`{data, updatedAt}`，≤50MB）            |

安全措施：

- 所有数据接口强制 Bearer 密钥，时序安全比较；
- 10 分钟内鉴权失败 ≥20 次临时限流（429）；
- 请求体 ≤50MB；
- 原子写入（临时文件 + 重命名），避免半截数据；
- 数据不含模型配置与 API Key。

---

## 五、CosBox 客户端设置

1. 打开 CosBox **设置 → 数据同步**；
2. 填写服务器地址（`http://ip:8787` 或 HTTPS 域名）与同步密钥；
3. 点「连接测试」确认可用，勾选启用后保存；
4. 本地任何状态/对话/世界书变化会在约 1.5 秒内推送到服务器，
   客户端每 5 秒拉取一次远端最新数据（按更新时间，较新一方胜出）。

> 未启用时不发起任何请求；密钥只保存在本地设置，不会上传。
