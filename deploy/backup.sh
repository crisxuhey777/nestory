#!/usr/bin/env bash
# ============================================================================
#  Nestory 备份：整库 mysqldump + 前端静态文件，保留 14 天
#
#  手动：  bash /opt/nestory/deploy/backup.sh
#  定时：  sudo crontab -e 加一行
#          30 3 * * * /bin/bash /opt/nestory/deploy/backup.sh >> /var/log/nestory-backup.log 2>&1
#
#  恢复：
#      gunzip -c /var/backups/nestory/nestory-2026-11-12-0330.sql.gz | mysql -unestory -p nestory
#      tar -xzf /var/backups/nestory/web-2026-11-12.tar.gz -C /var/www/nestory
# ============================================================================
set -euo pipefail

DEST="${1:-/var/backups/nestory}"
APP_DIR=/opt/nestory/backend
WEB_DIR=/var/www/nestory
KEEP_DAYS=14

mkdir -p "$DEST"
STAMP="$(date +%F-%H%M)"

PASS="$(sed -n 's/^NESTORY_DB_PASSWORD=//p' "$APP_DIR/db.env" | head -n1)"
[[ -n "$PASS" ]] || { echo "读不到数据库密码：$APP_DIR/db.env" >&2; exit 1; }

echo "[$(date '+%F %T')] dump database ..."
MYSQL_PWD="$PASS" mysqldump \
    -unestory -h127.0.0.1 \
    --single-transaction --quick --default-character-set=utf8mb4 \
    --no-tablespaces \
    nestory | gzip -9 > "$DEST/nestory-$STAMP.sql.gz"

if [[ -d "$WEB_DIR" ]]; then
    echo "[$(date '+%F %T')] archive frontend ..."
    tar -czf "$DEST/web-$STAMP.tar.gz" -C "$WEB_DIR" .
fi

find "$DEST" -maxdepth 1 -name 'nestory-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'web-*.tar.gz'      -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] done -> $DEST"
ls -lh "$DEST" | tail -n 5
