#!/usr/bin/env bash
set -euo pipefail
release_dir="$(cd "$(dirname "$0")/.." && pwd)"
tag="$(basename "$release_dir")"
image="signal-point-manager:$tag"
previous="signal-point-manager-before-$tag"
test -f /opt/signal-point-manager/data/signal-points.db
test -z "$(docker ps -aq --filter name="^$previous$")"
docker build -f "$release_dir/deploy/Dockerfile" -t "$image" "$release_dir"
docker cp "$release_dir/deploy/backup-db.cjs" signal-point-manager:/tmp/backup-db.cjs
docker exec signal-point-manager node /tmp/backup-db.cjs "/data/backups/before-$tag.db"
docker stop signal-point-manager
docker rename signal-point-manager "$previous"
rollback() {
  docker stop signal-point-manager || true
  docker rename signal-point-manager "signal-point-manager-failed-$tag" || true
  docker rename "$previous" signal-point-manager
  docker start signal-point-manager
}
trap rollback ERR
docker run -d --name signal-point-manager --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v /opt/signal-point-manager/data:/data \
  "$image"
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:8787/api/config > /dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8787/api/config > /dev/null
trap - ERR
printf 'Updated image: %s\nPersistent database retained. Previous container: %s\n' "$image" "$previous"
