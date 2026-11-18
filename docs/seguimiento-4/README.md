# Seguimiento #4 — índice Sports

Sports AWS (k3s/EC2 `us-east-2`) coordina **Hotel OCI** y **Cine GCP**. Experimentos reales **cerrados**; lab restaurado (`CHAOS_LAB_ENABLED=false`, flujo success).

| Documento | Contenido |
|---|---|
| `ARQUITECTURA_AWS.md` | Decisión k3s/EC2 vs EKS |
| `CONTRATOS_MULTICLOUD.md` | Contratos para Samuel y Daniel |
| `OBSERVABILIDAD.md` | Métricas y OTLP |
| `OTLP_OCI.md` | Collector OCI Samuel (auth/TLS/rollout) |
| `EXPERIMENTO_LATENCIA.md` | Interruptor de latencia (lab + intercloud) |
| `EXPERIMENTO_INTERCLOUD.md` | Latencia Sports→Hotel OCI |
| `EXPERIMENTO_HOTEL_503.md` | HTTP 503 Hotel OCI (Samuel) |
| `RESILIENCIA.md` | Timeout, fallback y circuit breaker |
| `RONDAS_R0_R1.md` | Procedimiento de rondas |
| `INFORME.md` | Informe final ≤6 páginas |
| `DEMO_SCRIPT.md` | Sustentación **sin** inyección de caos |
| `RELEASE.md` | SemVer **v4.2.0** (candidato) |
| `evidence/aws-validation/` | Validación Sports en AWS (mocks lab) |
| `evidence/multicloud-real/` | Integración real AWS→OCI→GCP |
| `evidence/aws-rounds/` | Baseline/R0/R1 mocks lab |
| `evidence/aws-intercloud/` | **Live canónico** `aws-intercloud-live-20261117191113` |
| `evidence/aws-hotel503/` | HTTP 503 — resultados definitivos + modos |
| `evidence/otel-oci/` | OTLP + W3C (incl. post-Cine `31-*`) |

## Experimentos (estado)

| Experimento | Coordinación | Evidencia | Estado |
|---|---|---|---|
| Hotel HTTP 503 | Samuel | `evidence/aws-hotel503/` | Cerrado |
| Cine (integración/W3C) | Daniel | `multicloud-real/` + `otel-oci/31-*` | Cerrado (verificación) |
| Latencia intercloud | Samuel (Tempo) | `aws-intercloud-live-20261117191113/` | Cerrado |
| Chaos Gate CI | — | [run 44204457598](https://github.com/JarrisonLopez/sports-tournaments-api/actions/runs/44204457598) | PASS (mocks ≠ cloud) |

## URLs del lab

| Servicio | URL |
|---|---|
| Sports AWS | http://3.21.120.51:30080 |
| Hotel OCI | http://149.130.165.30 |
| Cine GCP | http://35.239.107.54 |

Perfil k6 canónico: `load/k6/flujo-profile-shared.js`

## Comandos seguros (cierre / demo)

```powershell
npm test
npm run build
npm run chaos:rounds
npm run chaos:gate
node scripts/chaos/verify_hotel_503_local.mjs
# Perfil: k6 run load/k6/flujo-profile-shared.js
```

Scripts de experimento (`run_aws_*`, `set_aws_hotel503_mode` r0/r1, `-AuthorizeIntercloud`) son **históricos** — no re-ejecutar en el cierre.
