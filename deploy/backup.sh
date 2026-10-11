#!/usr/bin/env bash
# 每天备份数据库到 /opt/handbook/backups，保留 14 天。由 /etc/cron.d/handbook-backup 调用
set -euo pipefail
cd /opt/handbook
mkdir -p backups
file="backups/handbook-$(date +%Y%m%d-%H%M).sql.gz"
# root 密码只在容器里的环境变量中，不出现在命令行
docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction --routines --triggers -uroot -p"$MYSQL_ROOT_PASSWORD" handbook' \
  | gzip > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'handbook-*.sql.gz' -mtime +14 -delete
echo "备份完成：$file（$(du -h "$file" | cut -f1)）"
