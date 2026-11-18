#!/usr/bin/env bash
# Rollback del Deployment Sports al revision anterior de Kubernetes.
set -euo pipefail

NS="${SPORTS_NAMESPACE:-sports-lab}"
DEPLOY="${SPORTS_DEPLOYMENT:-sports-tournaments-api}"

kubectl -n "$NS" rollout undo deployment/"$DEPLOY"
kubectl -n "$NS" rollout status deployment/"$DEPLOY" --timeout=180s
kubectl -n "$NS" get pods -l app="$DEPLOY" -o wide
echo "Rollback OK"
