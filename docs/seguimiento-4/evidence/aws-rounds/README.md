# Evidencia AWS — Baseline / R0 / R1

**Run canónico:** `aws-rounds-20261116215016`  
**Fecha (UTC):** 2026-11-17T02:50–02:57  
**Base URL:** http://3.21.120.51:30080  
**Fallo:** latencia 800 ms inyectada en cliente Hotel de Sports (mocks lab)  
**Perfil k6:** stages 15s→2 VU, 45s→4 VU, 15s→0 (mismo en las tres rondas)

## Método

1. Quitar `env` hardcodeado del Deployment (pisaba el ConfigMap).
2. Aplicar `k8s/aws/configmap.exp-r0.yaml` (mocks + `CHAOS_LAB_ENABLED=true` + `RESILIENCE_ENABLED=false`).
3. Baseline k6 sin fallo.
4. Armar latencia en **ambas** réplicas (estado in-memory por pod).
5. R0 k6 con fallo y sin resiliencia nueva.
6. Aplicar `configmap.exp-r1.yaml` (timeout 400 + CB + fallback).
7. R1 k6 con la misma latencia.
8. Restaurar `k8s/aws/configmap.yaml` (Hotel OCI + Cine GCP, caos off).

Orquestador: `scripts/chaos/run_aws_rounds.ps1` + `scripts/chaos/aws-lab-helpers.sh`.

## Resultados medidos

| Métrica | Baseline | R0 | R1 | Objetivo a priori |
|---|---:|---:|---:|---|
| Iteraciones | 394 | 132 | 330 | mismo perfil |
| Éxito completo % | 100 | 100 | **0** | parcial ≠ completo |
| Parcial % | 0 | 0 | **100** | reportar aparte |
| Fallo % | 0 | 0 | 0 | — |
| Disponibilidad (full+partial) % | 100 | 100 | **100** | R1 ≥ 90 |
| p95 http_req_duration (ms) | 111.6 | 980.4 | **516.4** | R1 ≤ 70% R0 |
| Δ p95 R1 vs R0 | — | — | **−47.3%** | ≤ −30% |

Fuente: `aws-rounds-20261116215016/comparison.json` y `k6-*-summary.json`.

**Conclusión:** hipótesis **SOSTENIDA** a nivel disponibilidad. Nivel de servicio R1 = **partial** (compromiso: se preserva respuesta útil vía fallback; no se cuenta como éxito completo).

## Evidencia de timeout / circuit breaker / fallback

- Muestra R1: `04-r1-flujo-sample` → `status=partial`, `habitacion.origenResiliencia=fallback`, `providers.hotel.via=fallback`.
- Logs R1: primeras peticiones ~405 ms (`HOTEL_TIMEOUT_MS=400`); posteriores ~3–4 ms con CB abierto + fallback inmediato (`04-r1-logs.txt`).
- Armado multi-pod: `chaos-arm-r0.txt` / `chaos-arm-r1.txt` → `armed_pods=2`.

## Reversión

- `05-after-restore-k8s.txt`: ConfigMap real OCI/GCP.
- `05-after-ready`: `{"status":"ready"}`.
- `05-after-chaos`: `enabled=false`, `CHAOS_LAB_ENABLED` efectivo false (`tokenConfigured=false`).
- `05-after-flujo-multicloud`: `status=success`, hotel `149.130.165.30` upstream, cine `35.239.107.54` database — **sin mocks ni fallback**.

## Observabilidad

- Logs incluyen `traceId` + `otelTraceId`/`otelSpanId` por petición.
- `OTEL_EXPORTER_OTLP_ENDPOINT` vacío en lab: **no** hay spans recibidos por un Collector compartido (solo instrumentación/local Noop+logs).
