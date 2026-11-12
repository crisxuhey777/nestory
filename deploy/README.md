# Nestory 云服务器部署手册（一步一步照着做）

> 目标：浏览器打开 `https://你的域名/`，注册、记录、刷新后数据还在，AI 可用。
> 技术栈：Nginx（静态前端）+ Python 标准库 HTTP 服务（`backend/server.py`）+ MySQL 8。
> 全部命令都在 **Ubuntu 22.04 / 24.04** 上验证过逻辑；Windows 侧命令直接复制到 PowerShell。

## 0. 部署后的结构

```
浏览器
  │  https://your-domain.com
  ▼
Nginx :443
  ├── /            → /var/www/nestory        （Vite 构建产物 dist/）
  └── /api/...     → 127.0.0.1:8000          （systemd 服务 nestory）
                        ├── MySQL 127.0.0.1:3306（库 nestory）
                        └── llm.env → 智谱 GLM / OpenAI 兼容 / Pollinations
```

需要的账号 / 资源：

| 项目 | 要求 | 说明 |
|---|---|---|
| 云服务器 | 2 核 2G，Ubuntu 24.04，系统盘 20G+ | 1 核 1G 也能跑，但要加 swap |
| 安全组 / 防火墙 | 放行 TCP 22、80、443 | 3306 和 8000 **不要**对外开放 |
| 域名（可选） | A 记录指向服务器公网 IP | 大陆节点 80/443 需要 ICP 备案；香港/海外免备案，可先用 IP 访问 |
| 本地环境 | Node 20.19+（已有）、PowerShell、ssh/scp | Windows 10/11 自带 OpenSSH |

---

## 1. 购买服务器并放行端口

1. 阿里云「轻量应用服务器」或腾讯云「轻量」→ 镜像选 **Ubuntu 24.04 LTS** → 2 核 2G。
2. 控制台 → 防火墙 / 安全组 → 放行：`22`、`80`、`443`（协议 TCP，源 `0.0.0.0/0`）。
3. 记下 **公网 IP**（下文用 `<IP>` 代替）。

---

## 2. 第一次登录服务器

在 Windows PowerShell 里：

```powershell
ssh root@<IP>
```

首次连接输入 `yes`，再输密码（或使用密钥）。登录成功后提示符会变成 `root@xxx:~#`。
后面所有「服务器上」的命令都在这个窗口里执行。

---

## 3. 基础设置（5 分钟）

```bash
apt update && apt upgrade -y
apt install -y curl vim unzip

# 时区改成中国，否则「每日一句」和日期会差 8 小时
timedatectl set-timezone Asia/Shanghai
date

# 内存 ≤2G 时建议加 2G swap，MySQL 建库更稳
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

---

## 4. 上传代码

在 **Windows 的 PowerShell**、项目根目录 `D:\OneDrive\桌面\NESTORY` 下执行：

```powershell
ssh root@<IP> "mkdir -p /opt/nestory"
scp -r backend deploy root@<IP>:/opt/nestory/
```

> `backend/llm.env` 会一起传上去（AI 用你本机那把智谱 Key）。
> `backend/db.env` 也会传，但**第 5 步的脚本会按服务器上的数据库密码重写它**，不用管。
> 不要把 `node_modules`、`dist` 传到 `/opt/nestory`，前端有单独的目录。

确认上传结果：

```bash
ls /opt/nestory/backend/server.py /opt/nestory/deploy/install.sh
```

---

## 5. 一键安装（自动完成 6～9 步）

服务器上执行：

```bash
cd /opt/nestory/deploy
DOMAIN=baby.example.com EMAIL=you@example.com bash install.sh
```

- 还没域名、只想先用 IP 测试：直接 `bash install.sh`（脚本会跳过 HTTPS，并自动关闭 Cookie 的 Secure 标记）。
- 脚本可重复执行，不会重复建库或改密码；数据库密码写在 `/opt/nestory/db.password`。

脚本做的 9 件事：装依赖 → 建 `nestory` 用户 → 建库建账号 → 建 venv 装 `PyMySQL[rsa]` → 写 `db.env` → 建前端目录 → 装 systemd 服务 → 装 Nginx 站点 → ufw + 证书。

如果 `certbot` 那步报错，通常是域名还没解析，先继续往下做，第 8 步再补。

<details>
<summary><b>想手动一步步做（或脚本中途失败）时展开</b></summary>

```bash
# 6.1 依赖
apt install -y python3 python3-venv nginx mysql-server ufw rsync certbot python3-certbot-nginx

# 6.2 运行用户
useradd --system --create-home --home-dir /opt/nestory --shell /usr/sbin/nologin nestory

# 6.3 数据库（密码换成你自己的）
systemctl enable --now mysql
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS nestory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'nestory'@'localhost' IDENTIFIED BY 'REPLACE_ME';
CREATE USER IF NOT EXISTS 'nestory'@'127.0.0.1' IDENTIFIED BY 'REPLACE_ME';
GRANT ALL PRIVILEGES ON nestory.* TO 'nestory'@'localhost';
GRANT ALL PRIVILEGES ON nestory.* TO 'nestory'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# 6.4 Python 环境
python3 -m venv /opt/nestory/venv
/opt/nestory/venv/bin/pip install -r /opt/nestory/backend/requirements.txt

# 6.5 写 db.env
cat > /opt/nestory/backend/db.env <<'EOF'
NESTORY_DB_HOST=127.0.0.1
NESTORY_DB_PORT=3306
NESTORY_DB_USER=nestory
NESTORY_DB_PASSWORD=REPLACE_ME
NESTORY_DB_NAME=nestory
EOF
chmod 600 /opt/nestory/backend/db.env

# 6.6 服务
cp /opt/nestory/deploy/systemd/nestory.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now nestory
curl http://127.0.0.1:8000/api/health

# 6.7 Nginx
sed "s/__DOMAIN__/你的域名或_/" /opt/nestory/deploy/nginx/nestory.conf > /etc/nginx/sites-available/nestory
ln -sf /etc/nginx/sites-available/nestory /etc/nginx/sites-enabled/nestory
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 6.8 防火墙
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

</details>

---

## 6. 上传前端 `dist`

两种方式任选。

**A. 用现成的发布脚本（推荐，之后每次发版都用它）**

在 Windows 项目根目录：

```powershell
.\deploy\deploy.ps1 -Server <IP>
```

它会本机 `npm run build` → 打包 `backend/ dist/ deploy/` → scp → 服务器解包 → 重启 → `/api/health` 自检。带域名时：

```powershell
.\deploy\deploy.ps1 -Server baby.example.com
```

**B. 只传前端**

```powershell
npm.cmd run build
tar.exe -czf dist.tgz -C dist .
scp dist.tgz root@<IP>:/tmp/
ssh root@<IP> "rm -rf /var/www/nestory/* && tar -xzf /tmp/dist.tgz -C /var/www/nestory && chown -R www-data:www-data /var/www/nestory"
```

> 别忘了 `chown www-data`，否则 Nginx 403。

---

## 7. 验收清单

```bash
# 后端活着、数据库连上了
curl -s http://127.0.0.1:8000/api/health
# 期望：{"status":"ok", ... "db":{"ok":true,...}}

systemctl status nestory --no-pager
journalctl -u nestory -n 30 --no-pager
nginx -t
```

浏览器打开 `http://<IP>/`（或域名）：

1. 注册一个账号 → 能进首页；
2. 记一条喂养 / 睡眠 → 刷新页面数据还在；
3. 点一次 AI 总结 → 有内容返回。

三条都过，说明链路全通。

---

## 8. 域名 + HTTPS

1. 域名控制台加 A 记录：`@` / `www` → `<IP>`，等 1～5 分钟。
2. 服务器上：

```bash
certbot --nginx -d baby.example.com -m you@example.com --agree-tos --redirect
```

3. 证书自动续期（Ubuntu 装 certbot 后自带 timer）：

```bash
systemctl list-timers | grep certbot
```

> **重要**：用 HTTPS 后，把 `/etc/systemd/system/nestory.service` 里的
> `NESTORY_COOKIE_SECURE=0` 改回 `1`，然后 `systemctl daemon-reload && systemctl restart nestory`。
> 反向操作也行：只走 HTTP 时它必须是 `0`，否则登录状态一刷新就丢。

---

## 9. 日常更新（改完代码后）

```powershell
.\deploy\deploy.ps1 -Server baby.example.com
```

只改了前端？加 `-SkipBuild` 没用（仍会构建），想更快就直接用第 6 步的方式 B。
改了域名？重跑 `DOMAIN=... EMAIL=... bash install.sh` 即可。

---

## 10. 备份（强烈建议）

```bash
chmod +x /opt/nestory/deploy/backup.sh
bash /opt/nestory/deploy/backup.sh          # 手动跑一次，产物在 /var/backups/nestory

crontab -e
# 加一行：每天 03:30 自动备份，保留 14 天
30 3 * * * /bin/bash /opt/nestory/deploy/backup.sh >> /var/log/nestory-backup.log 2>&1
```

恢复数据库：

```bash
gunzip -c /var/backups/nestory/nestory-2026-11-12-0330.sql.gz | mysql -unestory -p nestory
```

---

## 11. 排错对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| 502 Bad Gateway | 后端没起来 / 端口不对 | `systemctl status nestory`；`ss -lntp \| grep 8000` |
| 页面 403 / 目录列表 | dist 权限不对 | `chown -R www-data:www-data /var/www/nestory` |
| 上传照片 413 | 请求体超过 Nginx 限制 | 已设 `client_max_body_size 20m`；确认改的是生效的那份 conf |
| AI 接口 504 | 模型响应超过 120s | 换更快的模型（`NESTORY_LLM_MODEL`），或调大 `proxy_read_timeout` |
| 注册报 503 `db_unavailable` | `db.env` 密码和 MySQL 账号不一致 | 重跑 `install.sh`（会重写 db.env），或手工核对 `mysql -unestory -p` |
| 登录后一刷新就退出 | Cookie 带了 `Secure` 但站点是 HTTP | `NESTORY_COOKIE_SECURE=0` 后重启服务 |
| 服务器上 AI 一直返回兜底文案 | 访问不了 `text.pollinations.ai` | 在 `backend/llm.env` 配智谱/任何 OpenAI 兼容接口，重启服务 |
| 安装 MySQL 后内存吃紧 | 1G 机器 | 加 swap，或换 2G 套餐 |
| 大陆节点域名打不开 | 未备案 | 先备案，或改用香港/海外节点 |

---

## 12. 安全清单（上线后逐条打勾）

- [ ] 3306、8000 没有暴露在公网（`ss -lntp` 只看到 `127.0.0.1`）
- [ ] `ufw status` 只有 22/80/443
- [ ] `/opt/nestory/backend/db.env` 权限 600，不在 Git 仓库里
- [ ] SSH 改成密钥登录、禁用密码（`/etc/ssh/sshd_config`）
- [ ] 已配 HTTPS 且 Cookie Secure 已开
- [ ] 备份 cron 生效（`ls -lh /var/backups/nestory`）
- [ ] `journalctl -u nestory` 里没有持续报错
