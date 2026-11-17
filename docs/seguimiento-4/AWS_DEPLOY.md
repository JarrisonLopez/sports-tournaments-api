# Despliegue AWS (PowerShell) — no ejecutado aún

Estado: **solo IaC**. No hay instancia EC2 provisionada desde este repositorio.

## Preflight local

```powershell
cd infra\aws\terraform
terraform fmt
terraform init -backend=false
terraform validate   # requiere red para descargar provider aws la primera vez
```

Comprobaciones estáticas K8s:

```powershell
Select-String -Path k8s\aws\deployment.yaml -Pattern 'replicas: 2|livenessProbe|readinessProbe|requests:|limits:'
```

## Capacidad (diseño)

| Recurso | Valor |
|---|---|
| EC2 | t3.small, disco 30 GB gp3 |
| Réplicas Sports | 2 pods (mismo nodo) |
| Requests/limits | 100m/128Mi → 500m/256Mi |
| MySQL lab | 1 pod + PVC 5Gi |
| NodePort | 30080 / SG abierto a `api_ingress_cidr` |
| SSH/k3s API | restringir `ssh_ingress_cidr` |

Limitación: 2 réplicas ≠ HA de nodo.

## Apply (SOLO con autorización)

```powershell
cd infra\aws\terraform
copy terraform.tfvars.example terraform.tfvars
# editar key_name y ssh_ingress_cidr=TU_IP/32
terraform init
terraform plan -out=tfplan
# terraform apply tfplan   # NO sin permiso
```

Tras el apply:

```powershell
# SSH a la EIP
ssh -i tu.pem ec2-user@<eip>
sudo cat /etc/rancher/k3s/k3s.yaml
# Ajustar server a la EIP y exportar KUBECONFIG local

# En la estación de trabajo (con kubectl apuntando a k3s, NO al GKE histórico):
$env:KUBECONFIG="C:\path\to\k3s.yaml"
docker build -t sports-tournaments-api:4.1.1 .
# transferir imagen al nodo o usar registry
bash infra/aws/scripts/deploy.sh   # o deploy.ps1
bash infra/aws/scripts/verify.sh
```

Rollback:

```powershell
bash infra/aws/scripts/rollback.sh
```

## Verificación esperada

- `kubectl -n sports-lab get deploy sports-tournaments-api` → READY 2/2
- `curl http://<eip>:30080/health/live`
- ConfigMap con `HOTEL_API_URL` / `CINE_API_URL` reales de compañeros
