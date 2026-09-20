#!/usr/bin/env bash
# Local SSL smoke test: nginx config, ACME path, self-signed HTTPS, then HTTP→HTTPS redirect.
# Does not talk to Let's Encrypt (that needs public DNS). Usage:
#   ./deploy/test-ssl.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${DOMAIN:-sp.matheager.com}"
NAME="management-ssl-test"
IMAGE="management-ssl-test:local"
HTTP_PORT="${HTTP_PORT:-18080}"
HTTPS_PORT="${HTTPS_PORT:-18443}"
HOST_HEADER="Host: ${DOMAIN}"
failures=0

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

echo "Building test image (nginx + SSL scripts, no frontend compile)..."
docker build -f "$ROOT/deploy/nginx/Dockerfile.test" -t "$IMAGE" "$ROOT" >/tmp/ssl-test-build.log

echo "Starting nginx on localhost:${HTTP_PORT} / ${HTTPS_PORT}..."
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  --add-host backend:127.0.0.1 \
  -e "DOMAIN=${DOMAIN}" \
  -e 'NGINX_ENVSUBST_FILTER=^DOMAIN$' \
  -p "${HTTP_PORT}:80" \
  -p "${HTTPS_PORT}:443" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -sf --max-time 1 -H "$HOST_HEADER" "http://127.0.0.1:${HTTP_PORT}/" >/dev/null; then
    break
  fi
  sleep 0.3
done

if docker exec "$NAME" nginx -t >/tmp/ssl-test-nginx-t.log 2>&1; then
  pass "nginx -t"
else
  fail "nginx -t"
  cat /tmp/ssl-test-nginx-t.log
fi

code="$(curl -sS -o /tmp/ssl-test-body -w '%{http_code}' --max-time 5 -H "$HOST_HEADER" "http://127.0.0.1:${HTTP_PORT}/" || echo 000)"
if [ "$code" = "200" ] && grep -q ssl-test /tmp/ssl-test-body; then
  pass "HTTP serves the app (no redirect yet)"
else
  fail "HTTP GET / expected 200 with ssl-test, got ${code}"
fi

docker exec "$NAME" sh -c 'mkdir -p /var/www/certbot/.well-known/acme-challenge && echo ping-acme > /var/www/certbot/.well-known/acme-challenge/ping'
code="$(curl -sS -o /tmp/ssl-test-body -w '%{http_code}' --max-time 5 -H "$HOST_HEADER" "http://127.0.0.1:${HTTP_PORT}/.well-known/acme-challenge/ping" || echo 000)"
if [ "$code" = "200" ] && grep -q ping-acme /tmp/ssl-test-body; then
  pass "ACME challenge path is served on port 80"
else
  fail "ACME GET expected 200 ping-acme, got ${code}"
fi

code="$(curl -skS -o /tmp/ssl-test-body -w '%{http_code}' --max-time 5 -H "$HOST_HEADER" "https://127.0.0.1:${HTTPS_PORT}/" || echo 000)"
if [ "$code" = "200" ]; then
  pass "HTTPS responds with the placeholder self-signed cert"
else
  fail "HTTPS GET / expected 200 (curl -k), got ${code}"
fi

issuer="$(docker exec "$NAME" openssl x509 -in /etc/nginx/ssl/fullchain.pem -noout -subject 2>/dev/null || true)"
if echo "$issuer" | grep -q "$DOMAIN"; then
  pass "Placeholder cert CN is ${DOMAIN}"
else
  fail "Placeholder cert subject: ${issuer}"
fi

echo "Simulating Let's Encrypt files appearing..."
docker exec "$NAME" sh -c "
  set -e
  mkdir -p /etc/letsencrypt/live/${DOMAIN}
  openssl req -x509 -nodes -newkey rsa:2048 -days 2 \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
    -subj '/CN=${DOMAIN}' >/dev/null 2>&1
  /usr/local/bin/prepare-ssl.sh
  nginx -s reload
"

sleep 1

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H "$HOST_HEADER" "http://127.0.0.1:${HTTP_PORT}/" || echo 000)"
location="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 5 -H "$HOST_HEADER" "http://127.0.0.1:${HTTP_PORT}/" || true)"
if [ "$code" = "301" ] && echo "$location" | grep -q "https://${DOMAIN}"; then
  pass "HTTP redirects to https://${DOMAIN} after cert appears"
else
  fail "HTTP GET / expected 301 to https://${DOMAIN}, got ${code} ${location}"
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H "$HOST_HEADER" "http://127.0.0.1:${HTTP_PORT}/.well-known/acme-challenge/ping" || echo 000)"
if [ "$code" = "200" ]; then
  pass "ACME path still works after HTTPS redirect is enabled"
else
  fail "ACME GET after redirect expected 200, got ${code}"
fi

hsts="$(curl -skSI --max-time 5 -H "$HOST_HEADER" "https://127.0.0.1:${HTTPS_PORT}/" | tr -d '\r' | grep -i '^strict-transport-security:' || true)"
if echo "$hsts" | grep -qi 'max-age=31536000'; then
  pass "HSTS is set on HTTPS after a real-looking cert is present"
else
  fail "Missing HSTS header, got: ${hsts:-none}"
fi

if [ "$failures" -ne 0 ]; then
  echo
  echo "${failures} SSL test(s) failed. nginx logs:"
  docker logs "$NAME" 2>&1 | tail -40
  exit 1
fi

echo
echo "All SSL tests passed."
echo "This does not contact Let's Encrypt. On the droplet, set CERTBOT_STAGING=1 to test real issuance with an untrusted cert, then set it back to 0 for a trusted certificate."
