# Seguimiento #4 — índice Sports

| Documento | Contenido |
|---|---|
| `ARQUITECTURA_AWS.md` | Decisión k3s/EC2 vs EKS |
| `CONTRATOS_MULTICLOUD.md` | Contratos para Samuel y Daniel |
| `OBSERVABILIDAD.md` | Métricas y OTLP |
| `EXPERIMENTO_LATENCIA.md` | Experimento + interruptor |
| `EXPERIMENTO_INTERCLOUD.md` | Latencia Sports→Hotel OCI (rúbrica) |
| `RESILIENCIA.md` | Timeout y circuit breaker |
| `RONDAS_R0_R1.md` | Procedimiento y resultados |
| `INFORME.md` | Informe ≤6 páginas |
| `DEMO_SCRIPT.md` | Guion de clase |
| `RELEASE.md` | SemVer y publicación |
| `evidence/aws-validation/` | Validación Sports en AWS (mocks lab) |
| `evidence/multicloud-real/` | Integración real AWS→OCI→GCP |
| `evidence/aws-rounds/` | Baseline / R0 / R1 medidos en k3s AWS (mocks) |
| `evidence/aws-intercloud/` | Preparación / rondas intercloud vs Hotel OCI |

## URLs activas (lab)

| Servicio | URL |
|---|---|
| Sports AWS | http://3.21.120.51:30080 |
| Hotel OCI | http://149.130.165.30 |
| Cine GCP | http://35.239.107.54 |

Rollback mocks: `k8s/aws/configmap.lab-mocks.yaml`  
Experimentos R0/R1 (temporal): `configmap.exp-r0.yaml` / `configmap.exp-r1.yaml`

## Comandos PowerShell rápidos

```powershell
npm test
npm run build
npm run chaos:rounds
.\scripts\chaos\run_aws_rounds.ps1 -BaseUrl "http://3.21.120.51:30080"
.\scripts\chaos\run_aws_intercloud_rounds.ps1   # dry-run; -AuthorizeIntercloud tras Samuel
.\load\run-k6.ps1 -Round baseline   # requiere k6 o Docker
kubectl apply --validate=false -f k8s/aws/namespace.yaml
```
