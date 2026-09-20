#!/bin/sh
set -e

DOMAIN="${DOMAIN:-sp.matheager.com}"
EMAIL="${CERTBOT_EMAIL:-}"

if [ -z "$EMAIL" ]; then
  echo "CERTBOT_EMAIL is not set; skipping Let's Encrypt"
  exec sleep infinity
fi

echo "Waiting for nginx to accept ACME challenges for ${DOMAIN}..."
sleep 8

echo "Requesting Let's Encrypt certificate for ${DOMAIN}"
until certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --keep-until-expiring \
  -d "$DOMAIN"
do
  echo "Let's Encrypt issuance failed (is DNS for ${DOMAIN} pointing here, and is port 80 open?). Retrying in 5 minutes."
  sleep 300
done

echo "Certificate issued. Renewing twice daily."
while true; do
  sleep 43200
  certbot renew --webroot --webroot-path=/var/www/certbot --quiet || true
done
