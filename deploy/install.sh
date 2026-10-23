#!/usr/bin/env bash
set -euo pipefail
release_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir=/opt/signal-point-manager
image="signal-point-manager:$(basename "$release_dir")"
config=/etc/nginx/conf.d/signal-point-manager.conf

# 本次为首次部署；已有线上数据或同名服务时停止，避免覆盖运行中的版本。
test ! -f "$app_dir/data/signal-points.db"
test ! -f "$config"
test -z "$(docker ps -aq --filter name='^signal-point-manager$')"
docker build -f "$release_dir/deploy/Dockerfile" -t "$image" "$release_dir"
install -d -m 750 -o 1000 -g 1000 "$app_dir/data"
install -m 600 -o 1000 -g 1000 "$release_dir/data/signal-points.db" "$app_dir/data/signal-points.db"
docker run -d --name signal-point-manager --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v "$app_dir/data:/data" \
  "$image"
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:8787/api/config > /dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8787/api/config > /dev/null
install -m 644 "$release_dir/deploy/nginx.conf" "$config"
if ! nginx -t; then
  mv "$config" "$release_dir/deploy/nginx.failed.conf"
  exit 1
fi
systemctl reload nginx
printf 'Deployed image: %s\n' "$image"
