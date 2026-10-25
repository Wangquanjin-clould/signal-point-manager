#!/usr/bin/env bash
set -euo pipefail
tls=/etc/signal-point-manager-ip-tls
openssl x509 -in "$tls/fullchain.pem" -noout -checkip 107.173.154.48
conf=/etc/nginx/conf.d/signal-point-manager-ip.conf
if [ -e "$conf" ]; then cp -p "$conf" "$conf.before-$(date +%Y%m%d%H%M%S)"; fi
cat > "$conf" <<'NGINX'
server {
    listen 10443 ssl default_server;
    listen [::]:10443 ssl default_server;
    server_name 107.173.154.48;
    ssl_certificate /etc/signal-point-manager-ip-tls/fullchain.pem;
    ssl_certificate_key /etc/signal-point-manager-ip-tls/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 10443;
        proxy_cookie_flags spt_sid secure;
    }
}
NGINX
nginx -t
systemctl reload nginx
cat > /etc/systemd/system/signal-point-manager-ip-certificate.service <<'UNIT'
[Unit]
Description=Renew signal point manager IP certificate and reload Nginx
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/signal-point-manager-renew-ip-certificate
UNIT
cat > /etc/systemd/system/signal-point-manager-ip-certificate.timer <<'UNIT'
[Unit]
Description=Check IP HTTPS certificate twice daily
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now signal-point-manager-ip-certificate.timer
systemctl start signal-point-manager-ip-certificate.service
curl --fail --silent -o /dev/null -w 'IP HTTPS status %{http_code}; TLS verify %{ssl_verify_result}\n' https://107.173.154.48:10443/
