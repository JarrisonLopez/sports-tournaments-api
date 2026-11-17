# Patrones de resiliencia — Timeout y Circuit Breaker

## Activación experimental

| Variable | R0 | R1 |
|---|---|---|
| `RESILIENCE_ENABLED` | `false` | `true` |

No se puede activar por query/body público. Solo entorno / ConfigMap.

## Timeout (Hotel)

- `HOTEL_TIMEOUT_MS` (default 2000)
- Usa `AbortSignal` vía `withTimeout`
- Error: `HotelTimeoutError`
- Métrica: `sports.hotel.timeouts` / outcome `timeout` en flujo

## Circuit breaker (Hotel)

Estados: `closed` → `open` → `half_open` → `closed`

| Variable | Default |
|---|---|
| `HOTEL_CB_FAILURE_THRESHOLD` | 3 |
| `HOTEL_CB_SUCCESS_THRESHOLD` | 1 |
| `HOTEL_CB_OPEN_MS` | 10000 |

Error en estado open: `CircuitOpenError`. Métricas de transición en `sports.hotel.circuit_breaker.*`.

## Fallback de Hotel (negocio)

Con `RESILIENCE_ENABLED=true`, `HOTEL_FALLBACK_ENABLED` default `true`.

Si ocurre `HotelTimeoutError` o `CircuitOpenError`, Sports devuelve una habitación **válida degradada** (`origenResiliencia: "fallback"`) y el flujo continúa con Cine → respuesta `status: "partial"`.

Sin fallback (solo para pruebas del mecanismo), timeout/CB propagan el error.

## Por qué mejora resiliencia (hipótesis R1)

Sin protecciones, la latencia inyectada eleva el p95 de éxitos (~800 ms+) y reduce el throughput bajo el mismo perfil de carga.

Con timeout + CB + fallback: se corta la espera, el breaker evita repetir delays y el flujo **sigue respondiendo 200** (parcial). Evidencia local: p95 de éxitos R1 ≤ 70% del de R0 y successRate ≥ 90%.
