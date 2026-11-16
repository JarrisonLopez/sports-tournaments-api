# Experimento — Latencia Sports → Hotel

## Declarativo

- Chaos Toolkit: `chaos/experiments/hotel-latency.yaml`
- Runner portable (Windows/CI): `scripts/chaos/run_hotel_latency_experiment.mjs`

## Interruptor propio

- `POST /chaos/hotel-latency` `{ token, latencyMs, ttlMs }`
- `DELETE /chaos/hotel-latency` header `x-chaos-token`
- `GET /chaos/hotel-latency`
- Requiere `CHAOS_LAB_ENABLED=true` y `CHAOS_FAULT_TOKEN` (≥32 chars)
- Expiración automática por TTL; reversión idempotente
- Afecta solo `obtenerHabitacion` (cliente Sports → Hotel)

## Hipótesis falsable

Con el perfil k6 fijo, al inyectar ~2000 ms de latencia en Sports→Hotel, el p95 del flujo supera 1500 ms y la tasa de éxito cae respecto al steady state / baseline. Tras habilitar timeout + circuit breaker (R1), la tasa de éxito y/o el tiempo de fallo controlado mejoran frente a R0 bajo la misma carga e inyección.

## Radio de impacto

Proceso Sports (cliente Hotel). No modifica la infra de Samuel. Mocks locales por defecto.

## Aborto / reversión

Abortar si `/health/ready` ≠ 200 o la activación falla. Siempre ejecutar DELETE del interruptor y verificar `enabled=false`.
