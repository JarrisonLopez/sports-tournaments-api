#!/usr/bin/env bash
# Orquestación post-EC2: cargar imagen, desplegar, verificar, k6, chaos, revertir.
# Requiere: kubectl apuntando al k3s, imagen local o tar, BASE_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NS="${SPORTS_NAMESPACE:-sports-lab}"
IMAGE="${SPORTS_IMAGE:-sports-tournaments-api:4.1.1}"
BASE_URL="${SPORTS_BASE_URL:-}"
STEP="${1:-help}"

usage() {
  cat <<'EOF'
Uso: remote-lab.sh <paso>

  import-image   Importa IMAGE al containerd de k3s (nodo local o via ctr)
  deploy         Aplica manifiestos (deploy.sh)
  verify         Verifica 2 réplicas + probes HTTP
  http-smoke     GET / y /api/v2/flujo/...
  k6             Ejecuta perfil fijo k6 contra SPORTS_BASE_URL
  chaos-latency  Activa/desactiva fallo de latencia Hotel vía script local
  full           deploy + verify + http-smoke (+ k6 si binario presente)

Variables: SPORTS_NAMESPACE SPORTS_IMAGE SPORTS_BASE_URL TORNEO_ID HABITACION_ID PELICULA_ID
EOF
}

require_base() {
  if [[ -z "$BASE_URL" ]]; then
    echo "Definir SPORTS_BASE_URL=http://<EIP>:30080"
    exit 1
  fi
}

case "$STEP" in
  help|-h|--help) usage ;;
  import-image)
    # En la EC2 con el tar: sudo k3s ctr images import sports.tar
    if [[ -n "${SPORTS_IMAGE_TAR:-}" && -f "$SPORTS_IMAGE_TAR" ]]; then
      sudo k3s ctr images import "$SPORTS_IMAGE_TAR"
    else
      echo "Construir y transferir:"
      echo "  docker build -t $IMAGE ."
      echo "  docker save $IMAGE -o sports-api.tar"
      echo "  scp sports-api.tar ec2-user@<EIP>:"
      echo "  ssh ec2-user@<EIP> 'sudo k3s ctr images import sports-api.tar'"
    fi
    ;;
  deploy)
    "$ROOT/infra/aws/scripts/deploy.sh"
    ;;
  verify)
    require_base
    SPORTS_BASE_URL="$BASE_URL" "$ROOT/infra/aws/scripts/verify.sh"
    ;;
  http-smoke)
    require_base
    curl -fsS "$BASE_URL/health/live"; echo
    curl -fsS "$BASE_URL/health/ready"; echo
    curl -fsS "$BASE_URL/"; echo
    TID="${TORNEO_ID:-1}"; HID="${HABITACION_ID:-1}"; PID="${PELICULA_ID:-1}"
    curl -fsS -H "x-trace-id: aws-smoke-1" \
      "$BASE_URL/api/v2/flujo/$TID/$HID/$PID" | head -c 2000; echo
    ;;
  k6)
    require_base
    command -v k6 >/dev/null || { echo "k6 no instalado"; exit 1; }
    mkdir -p "$ROOT/load/results"
    BASE_URL="$BASE_URL" ROUND=aws-lab RUN_ID="aws-$(date +%Y%m%d%H%M%S)" \
      k6 run "$ROOT/load/k6/flujo-profile.js"
    ;;
  chaos-latency)
    require_base
    echo "Usar scripts/chaos/run_hotel_latency_experiment.mjs con BASE_URL=$BASE_URL"
    echo "Revertir: curl -X DELETE $BASE_URL/api/v2/chaos/hotel-latency -H 'x-chaos-token: ...'"
    ;;
  full)
    "$0" deploy
    require_base
    "$0" verify
    "$0" http-smoke
    if command -v k6 >/dev/null; then "$0" k6; else echo "k6 omitido (no instalado)"; fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
