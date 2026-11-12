#!/usr/bin/env bash
# ============================================================================
#  Nestory 云服务器一键部署（Ubuntu 22.04 / 24.04）
#
#  用法（root）：
#      cd /opt/nestory/deploy
#      DOMAIN=baby.example.com EMAIL=you@example.com bash install.sh
#
#  只走 HTTP（暂不配证书）：
#      bash install.sh
#
#  前置：代码已上传到 /opt/nestory/backend，本目录为 /opt/nestory/deploy，
#        前端 dist 可稍后上传到 /var/www/nestory（本脚本会建好目录）。
#
#  可重复执行：已存在的数据、密码、配置不会被覆盖。
# ============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

APP_DIR=/opt/nestory/backend
BASE_DIR=/opt/nestory
VENV_DIR=$BASE_DIR/venv
WEB_DIR=/var/www/nestory
LOG_DIR=/var/log/nestory
SVC_USER=nestory
PASS_FILE=$BASE_DIR/db.password
NGX_SITE=/etc/nginx/sites-available/nestory
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[WARN] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[ERROR] %s\033[0m\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || die "请用 root 执行：sudo bash install.sh"
[[ -f "$APP_DIR/server.py" ]] || die "没找到 $APP_DIR/server.py，请先把 backend/ 上传到 $APP_DIR（见 deploy/README.md 第 4 步）"

# ---------------------------------------------------------------- 1. 系统依赖
say "1/9 安装系统依赖（nginx / mysql / python / ufw / certbot）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    nginx mysql-server \
    ufw rsync curl ca-certificates openssl \
    certbot python3-certbot-nginx

# ---------------------------------------------------------------- 2. 运行用户
say "2/9 创建运行用户 ${SVC_USER}"
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$BASE_DIR" --shell /usr/sbin/nologin "$SVC_USER"
fi

# ---------------------------------------------------------------- 3. MySQL
say "3/9 准备 MySQL 数据库与账号"
systemctl enable --now mysql
for _ in $(seq 1 30); do
    mysqladmin ping >/dev/null 2>&1 && break
    sleep 1
done
mysqladmin ping >/dev/null 2>&1 || die "MySQL 没有启动，查看：journalctl -u mysql -n 50"

if [[ -f "$PASS_FILE" ]]; then
    DB_PASS="$(cat "$PASS_FILE")"
    echo "   复用已有密码：$PASS_FILE"
else
    DB_PASS="$(openssl rand -hex 16)"
    printf '%s' "$DB_PASS" > "$PASS_FILE"
    chmod 600 "$PASS_FILE"
    echo "   新密码已写入：$PASS_FILE"
fi

mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS nestory
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'nestory'@'localhost' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS 'nestory'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER 'nestory'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER 'nestory'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON nestory.* TO 'nestory'@'localhost';
GRANT ALL PRIVILEGES ON nestory.* TO 'nestory'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
echo "   数据库 nestory 就绪（用户 nestory@localhost / 127.0.0.1）"

# ---------------------------------------------------------------- 4. Python 环境
say "4/9 创建 Python 虚拟环境并安装依赖"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -q -r "$APP_DIR/requirements.txt"
"$VENV_DIR/bin/python" -c "import pymysql, cryptography; print('   依赖 OK: pymysql', pymysql.__version__)"

# ---------------------------------------------------------------- 5. 配置
say "5/9 写入后端配置"
# 总是按本机生成的密码重写：即使误把开发机的 db.env 一起传上来，也会被纠正
cat > "$APP_DIR/db.env" <<EOF
NESTORY_DB_HOST=127.0.0.1
NESTORY_DB_PORT=3306
NESTORY_DB_USER=nestory
NESTORY_DB_PASSWORD=${DB_PASS}
NESTORY_DB_NAME=nestory
EOF
echo "   已写入 $APP_DIR/db.env（密码见 $PASS_FILE）"
if [[ ! -f "$APP_DIR/llm.env" ]]; then
    warn "没有 $APP_DIR/llm.env —— AI 会退回 Pollinations 免费接口；要换模型/Key 请照 llm.env.example 创建"
fi
chmod 600 "$APP_DIR/db.env" || true
chown -R "$SVC_USER:$SVC_USER" "$BASE_DIR"

# ---------------------------------------------------------------- 6. 前端目录
say "6/9 准备前端目录 $WEB_DIR"
install -d -o www-data -g www-data "$WEB_DIR"
install -d -o "$SVC_USER" -g "$SVC_USER" "$LOG_DIR"
if [[ -z "$(ls -A "$WEB_DIR" 2>/dev/null)" ]]; then
    warn "$WEB_DIR 还是空的，稍后用 scp 上传 dist/ 内容（见 README 第 6 步）"
fi

# ---------------------------------------------------------------- 7. systemd
say "7/9 安装并启动 nestory 服务"
install -m 0644 "$HERE/systemd/nestory.service" /etc/systemd/system/nestory.service
if [[ -z "$DOMAIN" ]]; then
    # 只有 HTTP 时开着 Secure，浏览器会丢掉会话 Cookie，表现为「登录后一刷新就退出」
    sed -i 's/^Environment=NESTORY_COOKIE_SECURE=1/Environment=NESTORY_COOKIE_SECURE=0/' \
        /etc/systemd/system/nestory.service
    echo "   未配域名 → 关闭 Cookie Secure（纯 HTTP 也能保持登录）"
fi
systemctl daemon-reload
systemctl enable nestory >/dev/null
systemctl restart nestory

sleep 2
if ! systemctl is-active --quiet nestory; then
    journalctl -u nestory -n 30 --no-pager || true
    die "nestory 服务没起来，看上面的日志"
fi
echo "   健康检查："
if curl -fsS --max-time 5 http://127.0.0.1:8000/api/health; then
    echo
else
    warn "/api/health 没返回，稍后执行 journalctl -u nestory -n 50 排查"
fi

# ---------------------------------------------------------------- 8. Nginx
say "8/9 安装 Nginx 站点"
sed "s/__DOMAIN__/${DOMAIN:-_}/" "$HERE/nginx/nestory.conf" > "$NGX_SITE"
ln -sf "$NGX_SITE" /etc/nginx/sites-enabled/nestory
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "   Nginx 已加载 server_name=${DOMAIN:-_}"

# ---------------------------------------------------------------- 9. 防火墙 + HTTPS
say "9/9 防火墙与 HTTPS"
if command -v ufw >/dev/null 2>&1; then
    ufw allow OpenSSH >/dev/null 2>&1 || true
    ufw allow 'Nginx Full' >/dev/null 2>&1 || true
    ufw --force enable >/dev/null 2>&1 || true
    echo "   ufw 已放行 22 / 80 / 443"
fi

if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
    echo "   申请 Let's Encrypt 证书：$DOMAIN"
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
        echo "   HTTPS 完成，证书 90 天自动续期"
    else
        warn "证书申请失败：请确认域名已解析到本机公网 IP，然后重跑："
        warn "  certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
        warn "https 没成就先把 Cookie Secure 关掉，否则登录会掉："
    fi
fi

# 只要最终没有生效的证书，就必须允许 HTTP 下带 Cookie
if [[ ! -d "/etc/letsencrypt/live/${DOMAIN:-none}" ]]; then
    if grep -q '^Environment=NESTORY_COOKIE_SECURE=1' /etc/systemd/system/nestory.service; then
        sed -i 's/^Environment=NESTORY_COOKIE_SECURE=1/Environment=NESTORY_COOKIE_SECURE=0/' \
            /etc/systemd/system/nestory.service
        systemctl daemon-reload
        systemctl restart nestory || true
        warn "当前没有 HTTPS 证书 → 已切到纯 HTTP 模式（NESTORY_COOKIE_SECURE=0）"
    fi
fi

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    warn "未传 DOMAIN/EMAIL，跳过 HTTPS。域名解析好以后执行："
    warn "  DOMAIN=baby.example.com EMAIL=you@example.com bash install.sh"
fi

# ---------------------------------------------------------------- 完成
IP="$(curl -fsS --max-time 3 https://api.ipify.org || hostname -I | awk '{print $1}')"
cat <<EOF

==============================================================
 Nestory 部署完成
--------------------------------------------------------------
 后端   : systemd 服务 nestory（127.0.0.1:8000）
 数据库 : MySQL 库 nestory
 前端   : $WEB_DIR  ← 上传 dist 后即可访问
 日志   : journalctl -u nestory -f   和  $LOG_DIR/
 站点   : http://${DOMAIN:-$IP}/
--------------------------------------------------------------
 还没上传前端？在 Windows 本机执行：
   npm run build
   scp -r dist\\* root@<服务器IP>:/var/www/nestory/
==============================================================
EOF
