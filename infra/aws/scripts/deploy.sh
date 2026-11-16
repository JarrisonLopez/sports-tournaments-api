#!/usr/bin/env bash
# Despliega manifiestos Sports en el cluster actual (k3s/kind/k3d).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NS="${SPORTS_NAMESPACE:-sports-lab}"
IMAGE="${SPORTS_IMAGE:-sports-tournaments-api:4.1.0}"

kubectl get ns "$NS" >/dev/null 2>&1 || kubectl apply -f "$ROOT/k8s/aws/namespace.yaml"

if ! kubectl -n "$NS" get secret sports-api-secrets >/dev/null 2>&1; then
  echo "Creando secret de laboratorio (cambiar en demo real)..."
  kubectl -n "$NS" create secret generic sports-api-secrets \
    --from-literal=DB_PASSWORD=sports_password \
    --from-literal=MYSQL_ROOT_PASSWORD=root_lab_password \
    --from-literal=CHAOS_FAULT_TOKEN=chaos-lab-token-minimo-32-chars!!
fi

kubectl apply -f "$ROOT/k8s/aws/configmap.yaml"
kubectl apply -f "$ROOT/k8s/aws/mysql/deployment.yaml"

# Sustituye imagen si se pasa SPORTS_IMAGE
tmp="$(mktemp)"
sed "s|image: sports-tournaments-api:4.1.0|image: ${IMAGE}|g" \
  "$ROOT/k8s/aws/deployment.yaml" >"$tmp"
kubectl apply -f "$tmp"
rm -f "$tmp"

kubectl apply -f "$ROOT/k8s/aws/service.yaml"

kubectl -n "$NS" rollout status deployment/sports-mysql --timeout=180s
kubectl -n "$NS" rollout status deployment/sports-tournaments-api --timeout=180s
echo "Deploy OK namespace=$NS image=$IMAGE"
