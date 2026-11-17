#!/usr/bin/env bash
set -euo pipefail

NS="${SPORTS_NAMESPACE:-sports-lab}"
BASE_URL="${SPORTS_BASE_URL:-http://127.0.0.1:30080}"

echo "== pods =="
kubectl -n "$NS" get pods -o wide
replicas="$(kubectl -n "$NS" get deploy sports-tournaments-api -o jsonpath='{.status.readyReplicas}')"
if [[ "${replicas:-0}" -lt 2 ]]; then
  echo "ERROR: se esperaban 2 réplicas ready, hay ${replicas:-0}"
  exit 1
fi

echo "== resources / probes =="
kubectl -n "$NS" get deploy sports-tournaments-api -o jsonpath='{.spec.template.spec.containers[0].resources}' ; echo
kubectl -n "$NS" get deploy sports-tournaments-api -o jsonpath='{.spec.template.spec.containers[0].livenessProbe.httpGet.path}' ; echo
kubectl -n "$NS" get deploy sports-tournaments-api -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.path}' ; echo

echo "== probes HTTP =="
curl -fsS "$BASE_URL/health/live" | tee /tmp/sports-live.json
echo
curl -fsS "$BASE_URL/health/ready" | tee /tmp/sports-ready.json
echo
curl -fsS "$BASE_URL/" | tee /tmp/sports-root.json
echo
echo "Verify OK ($replicas réplicas ready) base=$BASE_URL"
