#!/usr/bin/env bash
# Managed by signal-point-manager. Reuses the existing public key so installed
# Android versions with VPS pinning continue to connect after certificate renewal.
set -euo pipefail
tls=/etc/signal-point-manager-ip-tls
certbot=/opt/signal-point-manager/certbot-ip/bin/certbot
if [ -s "$tls/fullchain.pem" ] && openssl x509 -in "$tls/fullchain.pem" -checkend 259200 -noout; then exit 0; fi
umask 077
work=$(mktemp -d "$tls/issue.XXXXXX")
trap 'rm -rf "$work"' EXIT
"$certbot" certonly --non-interactive --agree-tos --webroot -w /var/www/signal-point-manager-acme \
  --preferred-profile shortlived --preferred-chain 'ISRG Root X1' --csr "$tls/request.csr" \
  --cert-path "$work/cert.pem" --chain-path "$work/chain.pem" --fullchain-path "$work/fullchain.pem"
openssl x509 -in "$work/cert.pem" -noout -checkip 107.173.154.48
openssl verify -CApath /etc/ssl/certs -untrusted "$work/chain.pem" "$work/cert.pem"
key_pin=$(openssl pkey -in "$tls/privkey.pem" -pubout -outform DER | openssl dgst -sha256 -binary | openssl base64 -A)
cert_pin=$(openssl x509 -in "$work/cert.pem" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | openssl base64 -A)
test "$key_pin" = "$cert_pin"
install -m 600 "$work/cert.pem" "$tls/cert.pem"
install -m 600 "$work/chain.pem" "$tls/chain.pem"
install -m 600 "$work/fullchain.pem" "$tls/fullchain.pem"
nginx -t
systemctl reload nginx
