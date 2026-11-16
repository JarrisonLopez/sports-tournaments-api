# Seguimiento #4 — índice Sports

| Documento | Contenido |
|---|---|
| `ARQUITECTURA_AWS.md` | Decisión k3s/EC2 vs EKS |
| `CONTRATOS_MULTICLOUD.md` | Contratos para Samuel y Daniel |
| `OBSERVABILIDAD.md` | Métricas y OTLP |
| `EXPERIMENTO_LATENCIA.md` | Experimento + interruptor |
| `RESILIENCIA.md` | Timeout y circuit breaker |
| `RONDAS_R0_R1.md` | Procedimiento y resultados |
| `INFORME.md` | Informe ≤6 páginas |
| `DEMO_SCRIPT.md` | Guion de clase |
| `RELEASE.md` | SemVer y publicación |

## Comandos PowerShell rápidos

```powershell
npm test
npm run build
npm run chaos:rounds
.\load\run-k6.ps1 -Round baseline   # requiere k6 o Docker
kubectl apply --validate=false -f k8s/aws/namespace.yaml
```
