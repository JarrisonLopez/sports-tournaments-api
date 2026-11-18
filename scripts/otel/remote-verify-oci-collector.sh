#!/usr/bin/env bash
set -eu
IP="${COLLECTOR_IP:-157.137.233.183}"
PORT="${COLLECTOR_PORT:-31443}"
echo "collector=$IP:$PORT"
echo "== TCP =="
timeout 5 bash -c "echo >/dev/tcp/$IP/$PORT" && echo tcp_ok || echo tcp_fail
echo "== TLS leaf =="
timeout 15 openssl s_client -connect "$IP:$PORT" -servername otel-lab.local </dev/null 2>/tmp/otel-tls.err \
  | openssl x509 -noout -subject -issuer -dates 2>/tmp/otel-x509.err || true
echo "tls_stderr_head:"
head -n 15 /tmp/otel-tls.err || true
echo "== HTTP POST /v1/traces sin auth (espera 401) =="
curl -k -sS -o /tmp/otel-body.txt -w "http_code=%{http_code} ssl_verify_result=%{ssl_verify_result}\n" --max-time 15 \
  -X POST "https://$IP:$PORT/v1/traces" \
  -H "Content-Type: application/x-protobuf" --data-binary "" || true
echo -n "body="; head -c 80 /tmp/otel-body.txt; echo
echo "== Pods sports =="
sudo kubectl -n sports-lab get pods -l app=sports-tournaments-api -o wide
echo "== Deploy =="
sudo kubectl -n sports-lab get deploy sports-tournaments-api
echo "== OTEL env (sin secrets) =="
sudo kubectl -n sports-lab get cm sports-api-config -o jsonpath='{.data.OTEL_EXPORTER_OTLP_ENDPOINT}{"\n"}{.data.OTEL_EXPORTER_OTLP_PROTOCOL}{"\n"}{.data.OTEL_SERVICE_NAME}{"\n"}'
echo "== Secret presence (names only) =="
sudo kubectl -n sports-lab get secret sports-otel-secrets sports-otel-ca 2>&1 | sed 's/[[:space:]]\+/ /g' || true
echo "== CA mount + hostAlias en pods =="
for p in $(sudo kubectl -n sports-lab get pods -l app=sports-tournaments-api -o jsonpath='{.items[*].metadata.name}'); do
  echo "pod=$p"
  sudo kubectl -n sports-lab exec "$p" -- sh -c 'ls -la /etc/otel 2>&1 || true; getent hosts hotel-otel-lab || true; echo OTEL_ENDPOINT=$OTEL_EXPORTER_OTLP_ENDPOINT; echo OTEL_PROTOCOL=$OTEL_EXPORTER_OTLP_PROTOCOL; echo OTEL_SERVICE=$OTEL_SERVICE_NAME; if [ -n "${OTEL_EXPORTER_OTLP_HEADERS:-}" ]; then echo HAS_HEADERS=yes; else echo HAS_HEADERS=no; fi'
done
