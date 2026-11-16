#!/usr/bin/env bash
# Validación offline de manifiestos (sin cluster).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if command -v kubectl >/dev/null 2>&1; then
  kubectl apply --dry-run=client -f "$ROOT/k8s/aws/namespace.yaml"
  kubectl apply --dry-run=client -f "$ROOT/k8s/aws/configmap.yaml"
  kubectl apply --dry-run=client -f "$ROOT/k8s/aws/mysql/deployment.yaml"
  kubectl apply --dry-run=client -f "$ROOT/k8s/aws/deployment.yaml"
  kubectl apply --dry-run=client -f "$ROOT/k8s/aws/service.yaml"
  echo "kubectl dry-run client OK"
else
  echo "kubectl no instalado; se valida presencia de archivos"
  test -f "$ROOT/k8s/aws/deployment.yaml"
  test -f "$ROOT/k8s/aws/service.yaml"
fi

# Comprueba réplicas=2 y probes en el Deployment
grep -q 'replicas: 2' "$ROOT/k8s/aws/deployment.yaml"
grep -q 'livenessProbe:' "$ROOT/k8s/aws/deployment.yaml"
grep -q 'readinessProbe:' "$ROOT/k8s/aws/deployment.yaml"
grep -q 'requests:' "$ROOT/k8s/aws/deployment.yaml"
grep -q 'limits:' "$ROOT/k8s/aws/deployment.yaml"
echo "Manifest checks OK"
