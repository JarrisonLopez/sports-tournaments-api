# Infra AWS — k3s sobre EC2 (lab académico)

## Justificación

**k3s en una EC2 `t3.medium` (4 GiB)** frente a EKS: costo bajo, Kubernetes real (Deployment ×2, Service NodePort 30080, probes, resources, MySQL + PVC). `t3.small` (2 GiB) queda justo para k3s + MySQL + 2 réplicas.

## Recursos Terraform (plan)

| Recurso | Detalle |
|---------|---------|
| EC2 | 1× `t3.medium`, AMI Amazon Linux 2023, root gp3 30 GiB |
| EIP | 1× (si `create_elastic_ip=true`) |
| Security Group | SSH 22, HTTP 80, NodePort 30080, k3s API 6443 (SSH CIDR) |
| VPC | Default VPC + subnet pública |
| user_data | Instala k3s (`--disable traefik`) |

**No crea:** EKS, ALB, RDS, NAT Gateway, CloudWatch agentes de pago.

## Costos / riesgos

- EC2 on-demand + EBS 30 GiB + EIP asociada (EIP sin asociar puede cobrar).
- Tráfico egress mínimo (pull mysql:8.4, get.k3s.io).
- Riesgo permanente: olvidar `terraform destroy` → cobro diario de la instancia.
- Destruir solo este lab: `CONFIRM_DESTROY=yes ./infra/aws/scripts/destroy.sh`

## Preflight herramientas (Windows)

```powershell
# Si registry.terraform.io falla por IPv6:
.\infra\aws\scripts\init-provider-mirror.ps1
$env:TF_CLI_CONFIG_FILE = (Resolve-Path .\infra\aws\terraform\terraform.rc.lab)
.\infra\aws\scripts\preflight-tools.ps1
.\infra\aws\scripts\terraform-check.ps1   # fmt/init/validate/plan — SIN apply
```

AWS CLI portable (sin admin): extraer MSI con `msiexec /a AWSCLIV2.msi TARGETDIR=infra\aws\.tools\aws-cli`.

## Uso (con autorización)

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# editar: key_name, ssh_ingress_cidr=<tu-ip>/32, aws_region
# Windows: ..\scripts\terraform-check.ps1
# Linux/mac: ../scripts/terraform-check.sh
# terraform apply               # SOLO con autorización explícita
```

Post-apply:

```bash
# SSH + esperar bootstrap
ssh -i <key.pem> ec2-user@$(terraform -chdir=infra/aws/terraform output -raw public_ip)
# en EC2: cat /opt/sports/bootstrap.status ; sudo cat /etc/rancher/k3s/k3s.yaml

# Desde estación: kubeconfig apuntando a EIP:6443
export SPORTS_BASE_URL=$(terraform -chdir=infra/aws/terraform output -raw api_url_hint)
docker build -t sports-tournaments-api:4.1.1 .
docker save sports-tournaments-api:4.1.1 -o sports-api.tar
scp -i <key.pem> sports-api.tar ec2-user@<EIP>:
ssh -i <key.pem> ec2-user@<EIP> 'sudo k3s ctr images import sports-api.tar'
./infra/aws/scripts/remote-lab.sh full
```

## Scripts

| Script | Función |
|--------|---------|
| `preflight-tools.ps1` | AWS CLI / Terraform / kubectl (readonly) |
| `terraform-check.sh` | fmt + init + validate + plan |
| `deploy.sh` / `deploy.ps1` | MySQL + Sports en cluster actual |
| `verify.sh` | 2 Ready + probes |
| `remote-lab.sh` | import/deploy/verify/http/k6 |
| `rollback.sh` | rollout undo Sports |
| `destroy.sh` | destroy Terraform (requiere `CONFIRM_DESTROY=yes`) |
| `validate-manifests.sh` | dry-run local |

## Estado

`apply` / `destroy` **no** se ejecutan sin autorización explícita.
