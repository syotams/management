#!/bin/sh
set -e

DOMAIN="${DOMAIN:-sp.matheager.com}"
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
SSL_DIR="/etc/nginx/ssl"
DUMMY_DIR="/etc/nginx/dummy"
HTTP_MODE="/etc/nginx/http-mode.conf"
SSL_HEADERS="/etc/nginx/ssl-headers.conf"

mkdir -p "$SSL_DIR" "$DUMMY_DIR" /var/www/certbot

if [ -s "${LE_DIR}/fullchain.pem" ] && [ -s "${LE_DIR}/privkey.pem" ]; then
  ln -sfn "${LE_DIR}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
  ln -sfn "${LE_DIR}/privkey.pem" "${SSL_DIR}/privkey.pem"
  cat > "$HTTP_MODE" <<'EOF'
location / {
    return 301 https://$host$request_uri;
}
EOF
  cat > "$SSL_HEADERS" <<'EOF'
add_header Strict-Transport-Security "max-age=31536000" always;
EOF
  echo "Using Let's Encrypt certificate for ${DOMAIN}"
else
  if [ ! -s "${DUMMY_DIR}/privkey.pem" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "${DUMMY_DIR}/privkey.pem" \
      -out "${DUMMY_DIR}/fullchain.pem" \
      -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  fi
  ln -sfn "${DUMMY_DIR}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
  ln -sfn "${DUMMY_DIR}/privkey.pem" "${SSL_DIR}/privkey.pem"
  cat > "$HTTP_MODE" <<'EOF'
include /etc/nginx/app-locations.conf;
EOF
  : > "$SSL_HEADERS"
  echo "No Let's Encrypt cert yet for ${DOMAIN}; serving HTTP until issuance succeeds"
fi
