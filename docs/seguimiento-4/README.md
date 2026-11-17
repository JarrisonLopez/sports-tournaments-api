# Seguimiento #4 — índice Sports

| Documento | Contenido |
|---|---|
| `ARQUITECTURA_AWS.md` | Decisión k3s/EC2 vs EKS |
| `CONTRATOS_MULTICLOUD.md` | Contratos para Samuel y Daniel |
| `OBSERVABILIDAD.md` | Métricas y OTLP |
| `OTLP_OCI.md` | Collector OCI Samuel (auth/TLS/rollout) |
| `EXPERIMENTO_LATENCIA.md` | Experimento + interruptor |
| `EXPERIMENTO_INTERCLOUD.md` | Latencia Sports→Hotel OCI (rúbrica) |
| `EXPERIMENTO_HOTEL_503.md` | Indisponibilidad HTTP 503 Hotel OCI (Samuel) |
| `RESILIENCIA.md` | Timeout y circuit breaker |
| `RONDAS_R0_R1.md` | Procedimiento y resultados |
| `INFORME.md` | Informe ≤6 páginas |
| `DEMO_SCRIPT.md` | Guion de clase |
| `RELEASE.md` | SemVer y publicación |
| `evidence/aws-validation/` | Validación Sports en AWS (mocks lab) |
| `evidence/multicloud-real/` | Integración real AWS→OCI→GCP |
| `evidence/aws-rounds/` | Baseline / R0 / R1 medidos en k3s AWS (mocks) |
| `evidence/aws-intercloud/` | Preparación / rondas intercloud vs Hotel OCI |
| `evidence/aws-hotel503/` | Preparación / rondas HTTP 503 Hotel OCI |
| `evidence/otel-oci/` | Conectividad OTLP → Collector OCI + traza muestra |

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
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode status   # Hotel 503 (Samuel); baseline|r0|r1|rollback
node scripts/chaos/verify_hotel_503_local.mjs
.\load\run-k6.ps1 -Round baseline   # requiere k6 o Docker
# Perfil canónico compartido: k6 run load/k6/flujo-profile-shared.js
kubectl apply --validate=false -f k8s/aws/namespace.yaml
```
