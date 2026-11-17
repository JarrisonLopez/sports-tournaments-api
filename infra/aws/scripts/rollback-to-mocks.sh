#!/usr/bin/env bash
# Rollback Sports a mocks locales en sports-lab (sin tocar Terraform).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NS="${SPORTS_NAMESPACE:-sports-lab}"
kubectl apply -f "$ROOT/k8s/aws/configmap.lab-mocks.yaml"
kubectl -n "$NS" rollout restart deployment/sports-tournaments-api
kubectl -n "$NS" rollout status deployment/sports-tournaments-api --timeout=180s
echo "Rollback a mocks OK"
