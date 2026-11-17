# Resultados definitivos — Hotel OCI HTTP 503

Ventana real con Samuel (Hotel OCI). Sports **no** inyectó latencia (`CHAOS_LAB_ENABLED=false`).

## Configuración idéntica (Baseline / R0 / R1)

| Ítem | Valor |
|---|---|
| Perfil k6 | `load/k6/flujo-profile-shared.js` |
| Stages | 15s→2 VU, 45s→4 VU, 15s→0 VU; sleep 0.3 s |
| Endpoint | `GET /api/v2/flujo/1/1/1` |
| Base URL | `http://3.21.120.51:30080` |
| Imagen Sports | `sports-tournaments-api:4.1.1-ac7b0fd` (`ac7b0fd`) |
| Hotel | OCI real `http://149.130.165.30` |
| Cine | GCP real `http://35.239.107.54` |
| Fallo | HTTP 503 en Hotel OCI (Samuel; TTL ~120 s por activación) |

## Hipótesis y umbrales a priori

Hipótesis: con resiliencia ON (timeout + CB + fallback ante Hotel 5xx), bajo el mismo 503 y la misma carga, Sports mantiene **disponibilidad degradada** (full+partial) frente a R0 sin resiliencia, sin confundir `partial` con éxito completo.

| Ronda | Umbral a priori |
|---|---|
| Baseline | `fullSuccessRate ≥ 0.95`, `errorRate ≤ 0.05`, `partialRate ≈ 0` |
| R0 (503) | `errorRate ≥ 0.90`, `fullSuccessRate ≤ 0.05` |
| R1 (503) | `availabilityRate ≥ 0.90`, `partialRate ≥ 0.80`, `fullSuccessRate ≤ 0.10` |

Fuente: `deploy-20261117000218/10-thresholds-apriori.txt` / `EXPERIMENTO_HOTEL_503.md`.

## Tabla definitiva

| | Baseline | R0 definitiva | R1 definitiva |
|---|---:|---:|---:|
| RUN_ID | `hotel503-baseline-20261117-003033` | `hotel503-r0-retry-20261117-004150` | `hotel503-r1-retry-20261117-011303` |
| Solicitudes | 289 | 320 | 349 |
| Completas (full) | 289 | 0 | 0 |
| Parciales | 0 | 0 | 349 |
| Fallidas | 0 | 320 | 0 |
| Disponibilidad (full+partial) | 100% | 0% | 100% (degradada) |
| Éxito completo | 100% | 0% | 0% |
| p95 (ms) | 312.02 | 224.13 | 234.60 |
| Umbrales a priori | Cumple | Cumple | Cumple |

JSON canónicos (también en `load/results/`):

- `runs-definitivos/baseline-hotel503-baseline-20261117-003033.json`
- `runs-definitivos/r0-hotel503-r0-retry-20261117-004150.json`
- `runs-definitivos/r1-hotel503-r1-retry-20261117-011303.json`

## Disponibilidad completa vs degradada

- Baseline: disponibilidad **completa** (200 + `status=success` + `degraded=false`).
- R0: **sin** disponibilidad del flujo (100% failed) — resiliencia OFF; el 503 de Hotel corta el orquestador.
- R1: disponibilidad **degradada** (100% partial) — HTTP 200 + fallback Hotel; **no** es éxito completo.

## Latencia p95

p95 R0 (224 ms) y R1 (234 ms) son del mismo orden y **menores** que Baseline (312 ms). En este fallo el 503 es rápido: no hay cola de espera larga; la ganancia de R1 no es “menos latencia”, sino **seguir respondiendo** con partial en lugar de fallar.

## Cobertura temporal del fallo

| Ronda | Cobertura |
|---|---|
| R0 definitiva | Fallo 503 confirmado durante **toda** la carga (0 full / 0 partial / 320 failed). |
| R1 definitiva | Hotel 503 activo durante **toda** la carga (confirmado por Samuel). Segunda ejecución R1; no mezclar con la provisional de 341 iters. |
| Observabilidad (Samuel) | Tempo: Sports partial, Hotel 503, Cine 200. 18 llamadas Hotel → HTTP 503 durante R1. Evidencias en repo de Samuel (p. ej. commit `e91ab94`); **no** están locales en Sports. |
| Post-carga | Hotel recuperado al finalizar (Samuel). |

## Circuit breaker

349 iteraciones R1 vs ~18 llamadas Hotel con 503 (reporte Samuel) es **compatible** con CB abierto que evita reintentar Hotel. No se archivan aquí capturas Grafana/Prometheus ni series `sports.hotel.circuit_breaker.*` de esa ventana; la afirmación de activación CB queda condicionada a esas evidencias externas / logs no copiados a este repo.

## Rollback confirmado

| Check | Resultado |
|---|---|
| Modo | `set_aws_hotel503_mode.ps1 -Mode rollback` → `mode-rollback-20261117012351/` |
| Ready | 2/2 |
| Flags | `RESILIENCE_ENABLED=true`, `HOTEL_FALLBACK_ENABLED=true`, `CHAOS_LAB_ENABLED=false` |
| Providers | Hotel OCI + Cine GCP |
| Flujo post-consolidación | 200, `status=success`, `degraded=false`, Hotel `upstream`, Cine `database` (`post-consolidation-flujo.json`) |
| Re-check status | `mode-status-20261117012717/` |

## Interpretación

1. **R0 100% failed:** sin timeout/CB/fallback, cada 503 de Hotel aborta el flujo.
2. **R1 100% partial:** con resiliencia ON, Hotel 5xx → habitación fallback → Cine OK → HTTP 200 `status=partial`.
3. **Partial ≠ full:** disponibilidad degradada ≠ éxito de negocio completo.
4. Hipótesis de **disponibilidad bajo 503** **sostenida** (R1 vs R0). Hipótesis de mejora p95 vs R0 **no aplica** igual que en latencia inyectada: aquí el fallo es rápido.

## Limitaciones

- Un nodo EC2 / k3s: sin HA de plataforma.
- TTL Samuel (~120 s) vs k6 (75 s): requiere activaciones **independientes** R0 y R1.
- Evidencia Tempo/Grafana/conteo 503 Hotel: en repo de Samuel, no duplicada aquí.
- Primera R1 (341 iters, 13 full) **no** es definitiva: cobertura incompleta del 503.
- Primera R0 (304 iters, 44 full) **ensayo**: 503 no cubrió toda la carga.

## Ensayos (no definitivos)

| RUN_ID | Motivo de descarte |
|---|---|
| `hotel-503-prueba-01` | Prueba previa de perfil / baseline |
| `hotel503-r0-20261117-003625` | R0 con 44 full — 503 no cubrió toda la ventana |
| `hotel503-r1-20261117-010050` | R1 provisional (341; 13 full / 328 partial) |

JSON en `runs-definitivos/ensayos/`.
