#!/usr/bin/env bash
# Destruye SOLO la infra Terraform de este seguimiento.
# NO ejecutar sin autorización explícita del dueño del laboratorio.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TFDIR="$ROOT/infra/aws/terraform"
cd "$TFDIR"

if [[ "${CONFIRM_DESTROY:-}" != "yes" ]]; then
  echo "Refusado: export CONFIRM_DESTROY=yes para destruir la infra de este proyecto."
  echo "Comando: CONFIRM_DESTROY=yes ./infra/aws/scripts/destroy.sh"
  exit 2
fi

terraform destroy -input=false "$@"
