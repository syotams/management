#!/bin/sh
# Poll for the first Let's Encrypt cert, then reload periodically so renewals apply.

DOMAIN="${DOMAIN:-sp.matheager.com}"
LE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

(
  while true; do
    if [ -s "$LE" ]; then
      /usr/local/bin/prepare-ssl.sh
      nginx -s reload 2>/dev/null || true
      sleep 43200
    else
      sleep 15
    fi
  done
) &
