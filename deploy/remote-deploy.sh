#!/usr/bin/env bash
# 在服务器上执行：换上新代码、构建镜像、迁移数据库、重启服务。由本地的 npm run deploy 调用
# 用法：bash remote-deploy.sh <域名> [--import]
#   --import  把代码里 content/ 的题目导入数据库。只在第一次部署、或者本地新写了题要发布时用：
#             上线后题目以线上后台为准，数据库里比文件新的题不会被覆盖
set -euo pipefail
DOMAIN="${1:?缺少域名}"
IMPORT="${2:-}"
BASE=/opt/handbook
cd "$BASE"

# 换上新代码，保留上一版，出问题时可以手动换回去
rm -rf src.prev
if [ -d src ]; then mv src src.prev; fi
mv src.new src
cp src/deploy/compose.yml src/deploy/Caddyfile src/deploy/mysql.cnf src/deploy/backup.sh .
chmod +x backup.sh
mkdir -p backups

# 第一次部署：随机生成数据库密码和登录密钥，只保存在服务器的 .env 里（只有 ubuntu 用户能读）
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
DB_ROOT_PASSWORD=$(openssl rand -hex 24)
NUXT_SESSION_PASSWORD=$(openssl rand -hex 32)

# AI 模拟面试官：在下面填写 Kimi 的 API Key，保存后执行 cd /opt/handbook && docker compose up -d app
NUXT_AI_API_KEY=
NUXT_AI_BASE_URL=https://api.moonshot.cn/v1
NUXT_AI_MODEL=kimi-k2-turbo-preview
NUXT_AI_DAILY_LIMIT=30

# 发信（注册验证码），例如 QQ 邮箱：smtp.qq.com、465、邮箱地址、在邮箱设置里生成的授权码
NUXT_MAIL_HOST=
NUXT_MAIL_PORT=465
NUXT_MAIL_USER=
NUXT_MAIL_PASS=
NUXT_MAIL_FROM=

# 问手册的向量模型（硅基流动 BAAI/bge-m3），不填时只用关键词检索
NUXT_EMBED_API_KEY=
EOF
  echo "已生成 /opt/handbook/.env"
fi
sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" .env

echo "== 构建镜像"
docker compose build app tools

echo "== 迁移数据库"
docker compose up -d mysql
docker compose run --rm tools npx tsx scripts/db.ts migrate
if [ "$IMPORT" = "--import" ]; then
  echo "== 导入题目"
  docker compose run --rm tools npx tsx scripts/db.ts import
fi

echo "== 启动服务"
docker compose up -d app caddy
status=starting
for _ in $(seq 1 45); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  sleep 2
done
echo "应用状态：$status"

# 每天 03:30（服务器时间）备份数据库
echo "30 3 * * * ubuntu /opt/handbook/backup.sh >> /opt/handbook/backups/backup.log 2>&1" | sudo tee /etc/cron.d/handbook-backup >/dev/null
docker image prune -f >/dev/null
[ "$status" = healthy ]
