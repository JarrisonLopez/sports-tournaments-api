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

## Por qué mejora resiliencia (hipótesis R1)

Sin protecciones, la latencia inyectada mantiene conexiones ocupadas hasta completar el delay + respuesta Hotel, degradando throughput y elevando p95.

Con timeout, las peticiones fallan rápido al superar el presupuesto; el circuit breaker evita martillar Hotel tras fallos repetidos, liberando capacidad para otras partes del flujo y acotando el blast radius temporal.
