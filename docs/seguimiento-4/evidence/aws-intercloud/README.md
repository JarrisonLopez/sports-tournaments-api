# Evidencia intercloud Sports AWS → Hotel OCI

## Estado

| Run | Tipo | Estado |
|---|---|---|
| `aws-intercloud-live-20261117191113` | **Live canónico** Baseline/R0/R1 | **Cerrado** — hipótesis SOSTENIDA |
| `aws-intercloud-dryrun-prepared` | Preparación previa | Sin inyección (histórico) |
| Dry-runs `…174855` / `…190744` | Preflight local | Opcionales; no sustituyen el live |

Experimento mocks de referencia: `../aws-rounds/aws-rounds-20261116215016/`.

## Resultados live (`comparison.json`)

| | Baseline | R0 | R1 |
|---|---:|---:|---:|
| full / partial / failed | 273 / 0 / 0 | 113 / 0 / 0 | 0 / 273 / 0 |
| Disponibilidad | 100% completa | 100% (lenta) | **100% degradada** |
| p95 (ms) | 360,13 | 1.230,35 | 624,50 (**−49,24%** vs R0) |

- Inyección: cliente saliente Sports → Hotel OCI (`injectionPoint=sports-outbound-hotel-client`).
- Perfil: `load/k6/flujo-profile-shared.js`.
- Imagen: `4.1.1-ac7b0fd`.
- R1 = partial (disponibilidad degradada ≠ éxito completo).
- Rollback: `05-after-*` — caos OFF, Hotel OCI + Cine GCP, flujo `success`.
- Resumen espejo: `chaos/results/aws-intercloud-latest.json`.

## Tempo (Samuel)

- R0: ~802 ms de espera antes de contactar Hotel.
- R1: fallback ~400 ms **sin** HTTP a Hotel.
- Cine operativo.
- No se afirma circuit breaker OPEN sin evidencia explícita de transición.

## Configuración usada

| Ítem | Valor |
|---|---|
| Baseline CM | `configmap.exp-intercloud-baseline.yaml` (res ON, sin fallo) |
| R0 / R1 CM | `exp-intercloud-r0` / `exp-intercloud-r1` + OTLP |
| Restore | `try/finally` → `configmap.yaml` |

```powershell
# NO re-ejecutar en cierre. Histórico:
# .\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud
```
