#!/usr/bin/env bash
set -euo pipefail
release_dir="$(cd "$(dirname "$0")/.." && pwd)"
tag="$(basename "$release_dir")"
previous="signal-point-manager-before-$tag"
image="signal-point-manager:$tag"
base=/opt/signal-point-manager
nginx_conf=/etc/nginx/conf.d/signal-point-manager.conf
nginx_backup="$base/nginx-before-$tag.conf"
test -z "$(docker ps -aq --filter name="^$previous$")"
test -f "$base/data/signal-points.db"
docker build -f "$release_dir/deploy/Dockerfile" -t "$image" "$release_dir"
docker cp "$release_dir/deploy/backup-db.cjs" signal-point-manager:/tmp/mobile-backup.cjs
docker cp "$release_dir/deploy/verify-db.cjs" signal-point-manager:/tmp/mobile-verify.cjs
docker exec signal-point-manager node /tmp/mobile-backup.cjs "/data/backups/before-$tag.db"
docker exec signal-point-manager node /tmp/mobile-verify.cjs /data/signal-points.db > "$base/before-$tag.json"
umask 077
if [ ! -s "$base/mobile-sync.env" ]; then
  { printf 'MOBILE_SYNC_TOKEN='; openssl rand -hex 32; } > "$base/mobile-sync.env"
fi
chmod 600 "$base/mobile-sync.env"
cp "$nginx_conf" "$nginx_backup"
docker stop signal-point-manager
docker rename signal-point-manager "$previous"
rollback() {
  docker stop signal-point-manager || true
  docker rename signal-point-manager "signal-point-manager-failed-$tag" || true
  docker rename "$previous" signal-point-manager
  docker start signal-point-manager
  cp "$nginx_backup" "$nginx_conf"
  nginx -t && systemctl reload nginx
}
trap rollback ERR
docker run -d --name signal-point-manager --restart unless-stopped --env-file "$base/mobile-sync.env" -p 127.0.0.1:8787:8787 -v "$base/data:/data" "$image"
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8787/api/config > /dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8787/api/config > /dev/null
docker cp "$release_dir/deploy/verify-db.cjs" signal-point-manager:/tmp/mobile-verify.cjs
docker exec signal-point-manager node /tmp/mobile-verify.cjs /data/signal-points.db > "$base/after-$tag.json"
docker cp "$base/before-$tag.json" signal-point-manager:/tmp/before-mobile.json
docker cp "$base/after-$tag.json" signal-point-manager:/tmp/after-mobile.json
docker exec --user root signal-point-manager node -e 'const fs=require("node:fs");const a=JSON.parse(fs.readFileSync("/tmp/before-mobile.json")),b=JSON.parse(fs.readFileSync("/tmp/after-mobile.json"));if(a.sha256!==b.sha256||Object.values(b.integrity)[0]!=="ok")throw Error("Data changed");console.log(JSON.stringify({businessAndAccountsUnchanged:true,counts:b.counts,integrity:b.integrity}));'
sed -i 's/client_max_body_size 2m;/client_max_body_size 20m;/' "$nginx_conf"
nginx -t
systemctl reload nginx
test "$(curl --connect-timeout 5 --max-time 15 --resolve www.engineer-service-report.top:10443:127.0.0.1 --silent -o /dev/null -w '%{http_code}' https://www.engineer-service-report.top:10443/api/mobile/sync)" = 401
docker exec signal-point-manager node -e 'fetch("http://127.0.0.1:8787/api/mobile/sync",{headers:{"X-Mobile-Sync-Token":process.env.MOBILE_SYNC_TOKEN}}).then(async r=>{if(r.status!==200)throw Error("Sync health check");const j=await r.json();if(j.version!==1||j.records.some(x=>["users","sessions"].includes(x.table)))throw Error("Snapshot privacy");console.log(JSON.stringify({syncVersion:j.version,businessRecords:j.records.length,accountDataExported:false}));}).catch(e=>{console.error(e);process.exitCode=1;});'
trap - ERR
printf 'Mobile sync enabled. Previous image retained: %s\n' "$previous"
