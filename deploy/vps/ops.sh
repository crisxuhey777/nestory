#!/usr/bin/env bash
# 服务器上的日常运维小工具（在 /opt/nestory 下执行）。
#
#   ./deploy/vps/ops.sh status     # 三个容器 + 磁盘 + 最近一次备份
#   ./deploy/vps/ops.sh logs       # 跟踪应用日志
#   ./deploy/vps/ops.sh update     # git pull + 重新构建 + 滚动重启
#   ./deploy/vps/ops.sh backup     # 立刻备份一次
#   ./deploy/vps/ops.sh smoke      # 冒烟测试（健康检查 + 首页 + 未登录 401）

set -euo pipefail
cd "$(dirname "$0")/../.."
VPS_DIR="deploy/vps"
COMPOSE=(docker compose -f "$VPS_DIR/docker-compose.yml" --project-directory "$VPS_DIR")

DOMAIN="$(grep -E '^DOMAIN=' "$VPS_DIR/.env" | cut -d= -f2- | tr -d '\r')"

case "${1:-status}" in
  status)
    "${COMPOSE[@]}" ps
    echo "--- disk ---"
    df -h / | tail -1
    du -sh "$VPS_DIR/data"/* 2>/dev/null || true
    echo "--- last backups ---"
    ls -lt "$VPS_DIR/data/backup" 2>/dev/null | head -3 || echo "(还没有备份，先跑 ./deploy/vps/backup.sh)"
    ;;
  logs)
    "${COMPOSE[@]}" logs -f --tail=100 app
    ;;
  update)
    git pull --ff-only
    "${COMPOSE[@]}" up -d --build
    "${COMPOSE[@]}" ps
    ;;
  backup)
    "$VPS_DIR/backup.sh"
    ;;
  smoke)
    echo "GET https://$DOMAIN/api/health"
    curl -fsS --max-time 10 "https://$DOMAIN/api/health"; echo
    echo "GET https://$DOMAIN/ (title)"
    curl -fsS --max-time 10 "https://$DOMAIN/" | grep -o '<title>[^<]*</title>' | head -1
    echo "GET https://$DOMAIN/api/auth/me (期望 401)"
    curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "https://$DOMAIN/api/auth/me"
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
