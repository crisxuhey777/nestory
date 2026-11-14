#!/usr/bin/env bash
# Nestory 每日备份：MySQL 全量 dump（每天）+ 媒体目录打包（每周日）。
#
# 安装（在服务器上）：
#   chmod +x /opt/nestory/deploy/vps/backup.sh
#   crontab -e
#   30 3 * * * /opt/nestory/deploy/vps/backup.sh >> /var/log/nestory-backup.log 2>&1
#
# 产物：data/backup/db-<UTC时间>.sql.gz、media-<UTC时间>.tar.gz，保留 KEEP_DAYS 天。
# 恢复：
#   gunzip -c data/backup/db-20260101-033000.sql.gz \
#     | docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
#   docker compose stop app && tar -xzf data/backup/media-....tar.gz -C data && docker compose start app

set -euo pipefail
cd "$(dirname "$0")"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
KEEP_DAYS="${NESTORY_BACKUP_KEEP_DAYS:-14}"
mkdir -p data/backup

echo "[$(date '+%F %T')] db dump -> data/backup/db-$STAMP.sql.gz"
docker compose exec -T db sh -c \
  'exec mysqldump --single-transaction --quick --no-tablespaces \
     --default-character-set=utf8mb4 \
     -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip -9 > "data/backup/db-$STAMP.sql.gz"

# 媒体目录会随着照片变大，天天整包压缩太费 IO；每周日打包一次
if [ "$(date +%u)" = "7" ]; then
  echo "[$(date '+%F %T')] media archive -> data/backup/media-$STAMP.tar.gz"
  tar -czf "data/backup/media-$STAMP.tar.gz" -C data media
fi

find data/backup -maxdepth 1 -name '*.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] kept:"
ls -lh data/backup | tail -n 6

# ---- 可选：再同步一份到异地（Cloudflare R2 / 阿里云 OSS / OneDrive）----
# 先装 rclone 并配好 remote（rclone config），再取消下面两行注释：
# rclone copy data/backup/ r2:nestory-backup/ --max-age 2d --transfers 2
# echo "[$(date '+%F %T')] offsite copy ok"
