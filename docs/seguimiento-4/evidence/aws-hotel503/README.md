# Evidencia — Hotel OCI HTTP 503

Procedimiento: `docs/seguimiento-4/EXPERIMENTO_HOTEL_503.md`  
Resultados canónicos: `RESULTADOS_DEFINITIVOS.md`  
Modos: `scripts/chaos/set_aws_hotel503_mode.ps1`  
Perfil k6: `load/k6/flujo-profile-shared.js`

| Ítem | Estado |
|---|---|
| Prueba local 503 (Vitest) | `npm run chaos:verify-hotel-503` |
| ConfigMaps R0/R1 | `k8s/aws/configmap.exp-hotel503-r0.yaml` / `…-r1.yaml` |
| Deploy fix en AWS | `deploy-20261117000218/` — imagen `4.1.1-ac7b0fd`, 2/2 Ready |
| Fallo real OCI | **Ejecutado** (ventana Samuel) — ver `RESULTADOS_DEFINITIVOS.md` |
| JSON definitivos | `runs-definitivos/` (+ copias en `load/results/`) |
| Rollback | `mode-rollback-20261117012351/` + re-check `mode-status-20261117012717/` |

## RUN_ID definitivos

| Ronda | RUN_ID |
|---|---|
| Baseline | `hotel503-baseline-20261117-003033` |
| R0 | `hotel503-r0-retry-20261117-004150` |
| R1 | `hotel503-r1-retry-20261117-011303` |

## Carpetas de modo (Sports)

| Carpeta | Uso |
|---|---|
| `mode-baseline-20261117002626/` | Apply baseline pre-carga |
| `mode-r0-20261117003321/` | Apply R0 (resiliencia OFF) |
| `mode-r1-20261117005450/` | Apply R1 (resiliencia ON) |
| `mode-rollback-20261117012351/` | Restauración estable + flujo success |
| `mode-status-*` | Snapshots Ready / env (incl. post-experimento) |
| `final-local-validation/` | Validación local previa (no sustituye OCI) |

Evidencias Tempo/Grafana y conteo de 503 en Hotel: repo de Samuel (p. ej. commit `e91ab94`); no afirmadas como archivos locales aquí.
