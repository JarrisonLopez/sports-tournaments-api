#!/usr/bin/env bash
# fmt + init + validate + plan (NUNCA apply).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TFDIR="$ROOT/infra/aws/terraform"
cd "$TFDIR"

echo "== terraform fmt =="
terraform fmt -recursive -check || terraform fmt -recursive

echo "== terraform init =="
terraform init -input=false

echo "== terraform validate =="
terraform validate

if [[ -f terraform.tfvars ]]; then
  VARFILE=terraform.tfvars
else
  echo "AVISO: sin terraform.tfvars; generando placeholders temporales."
  cat > terraform.tfvars.plancheck <<'EOF'
aws_region         = "us-east-1"
environment        = "lab"
project_name       = "sports-chaos"
instance_type      = "t3.medium"
ssh_ingress_cidr   = "127.0.0.1/32"
api_ingress_cidr   = "0.0.0.0/0"
key_name           = ""
create_elastic_ip  = true
EOF
  VARFILE=terraform.tfvars.plancheck
fi

echo "== terraform plan (var-file=$VARFILE) =="
terraform plan -input=false -var-file="$VARFILE" -out=tfplan-lab.bin
terraform show -no-color tfplan-lab.bin | head -n 200

echo "terraform-check OK (sin apply)"
