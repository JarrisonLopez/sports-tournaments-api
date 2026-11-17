#!/bin/sh
# Helpers executed ON the EC2 k3s node (sports-lab).
set -eu
NS="${SPORTS_NAMESPACE:-sports-lab}"
TOKEN="${CHAOS_FAULT_TOKEN:-chaos-lab-token-minimo-32-chars!!}"
LATENCY_MS="${CHAOS_HOTEL_LATENCY_MS:-800}"
TTL_MS="${CHAOS_HOTEL_LATENCY_TTL_MS:-120000}"

cmd="${1:-}"

clear_env_overrides() {
  if sudo kubectl -n "$NS" get deploy sports-tournaments-api -o jsonpath='{.spec.template.spec.containers[0].env}' 2>/dev/null | grep -q .; then
    echo "Removing container env overrides..."
    sudo kubectl -n "$NS" patch deploy sports-tournaments-api --type=json \
      -p='[{"op":"remove","path":"/spec/template/spec/containers/0/env"}]'
  else
    echo "No container env overrides"
  fi
}

rollout() {
  sudo kubectl -n "$NS" rollout restart deployment/sports-tournaments-api
  sudo kubectl -n "$NS" rollout status deployment/sports-tournaments-api --timeout=180s
  sleep 5
}

verify_env() {
  expect_hotel="${1:-}"
  POD=$(sudo kubectl -n "$NS" get pods -l app=sports-tournaments-api -o jsonpath='{.items[0].metadata.name}')
  echo "pod=$POD"
  CHAOS=$(sudo kubectl -n "$NS" exec "$POD" -- printenv CHAOS_LAB_ENABLED)
  RES=$(sudo kubectl -n "$NS" exec "$POD" -- printenv RESILIENCE_ENABLED)
  HOTEL=$(sudo kubectl -n "$NS" exec "$POD" -- printenv HOTEL_API_URL)
  CINE=$(sudo kubectl -n "$NS" exec "$POD" -- printenv CINE_API_URL)
  echo "CHAOS_LAB_ENABLED=$CHAOS"
  echo "RESILIENCE_ENABLED=$RES"
  echo "HOTEL_API_URL=$HOTEL"
  echo "CINE_API_URL=$CINE"
  if [ -n "$expect_hotel" ]; then
    echo "$HOTEL" | grep -q "$expect_hotel" || {
      echo "ERROR: expected HOTEL_API_URL to contain $expect_hotel" >&2
      exit 1
    }
  fi
}

snapshot() {
  sudo kubectl get pods,deploy,cm,svc -n "$NS" -o wide
  echo "---"
  sudo kubectl get cm sports-api-config -n "$NS" -o yaml
}

arm_all() {
  printf '%s' "{\"token\":\"$TOKEN\",\"latencyMs\":$LATENCY_MS,\"ttlMs\":$TTL_MS}" > /tmp/chaos-arm.json
  OK=0
  for p in $(sudo kubectl -n "$NS" get pods -l app=sports-tournaments-api -o jsonpath='{.items[*].metadata.name}'); do
    IP=$(sudo kubectl -n "$NS" get pod "$p" -o jsonpath='{.status.podIP}')
    RESP=$(curl -s -X POST "http://$IP:8080/chaos/hotel-latency" \
      -H 'content-type: application/json' --data-binary @/tmp/chaos-arm.json || true)
    echo "$p $IP $RESP"
    echo "$RESP" | grep -q '"enabled":true' && OK=$((OK + 1))
  done
  echo "armed_pods=$OK"
  [ "$OK" -ge 2 ]
}

disarm_all() {
  for p in $(sudo kubectl -n "$NS" get pods -l app=sports-tournaments-api -o jsonpath='{.items[*].metadata.name}'); do
    IP=$(sudo kubectl -n "$NS" get pod "$p" -o jsonpath='{.status.podIP}')
    curl -s -X DELETE "http://$IP:8080/chaos/hotel-latency" -H "x-chaos-token: $TOKEN" || true
    echo
  done
  curl -s http://127.0.0.1:30080/chaos/hotel-latency; echo
}

logs_tail() {
  sudo kubectl -n "$NS" logs deploy/sports-tournaments-api --all-containers --tail=250 || \
    sudo kubectl -n "$NS" logs -l app=sports-tournaments-api --tail=250
}

case "$cmd" in
  clear-env) clear_env_overrides ;;
  rollout) rollout ;;
  verify-env) verify_env "${2:-}" ;;
  snapshot) snapshot ;;
  arm) arm_all ;;
  disarm) disarm_all ;;
  logs) logs_tail ;;
  prepare-exp)
    clear_env_overrides
    rollout
    verify_env "${2:-hotel-mock}"
    ;;
  *)
    echo "usage: $0 {clear-env|rollout|verify-env|snapshot|arm|disarm|logs|prepare-exp} [expect]"
    exit 1
    ;;
esac
