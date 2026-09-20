#!/bin/sh
set -e

DOMAIN="${DOMAIN:-sp.matheager.com}"
EMAIL="${CERTBOT_EMAIL:-}"
STAGING="${CERTBOT_STAGING:-0}"

if [ -z "$EMAIL" ]; then
  echo "CERTBOT_EMAIL is not set; skipping Let's Encrypt"
  exec sleep infinity
fi

echo "Waiting for nginx to accept ACME challenges for ${DOMAIN}..."
sleep 8

set -- certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --keep-until-expiring \
  -d "$DOMAIN"

if [ "$STAGING" = "1" ] || [ "$STAGING" = "true" ]; then
  set -- "$@" --staging
  echo "Using Let's Encrypt STAGING for ${DOMAIN} (browsers will warn; this avoids production rate limits)"
else
  LE_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  if [ -s "$LE_CERT" ] && openssl x509 -in "$LE_CERT" -noout -issuer 2>/dev/null | grep -qi staging; then
    echo "Existing certificate is staging; requesting a production certificate"
    set -- certonly \
      --webroot \
      --webroot-path=/var/www/certbot \
      --email "$EMAIL" \
      --agree-tos \
      --no-eff-email \
      --non-interactive \
      --force-renewal \
      -d "$DOMAIN"
  else
    echo "Requesting Let's Encrypt certificate for ${DOMAIN}"
  fi
fi

until certbot "$@"; do
  echo "Let's Encrypt issuance failed (is DNS for ${DOMAIN} pointing here, and is port 80 open?). Retrying in 5 minutes."
  sleep 300
done

echo "Certificate issued. Renewing twice daily."
RENEW_STAGING=""
if [ "$STAGING" = "1" ] || [ "$STAGING" = "true" ]; then
  RENEW_STAGING="--staging"
fi
while true; do
  sleep 43200
  certbot renew --webroot --webroot-path=/var/www/certbot --quiet $RENEW_STAGING || true
done
