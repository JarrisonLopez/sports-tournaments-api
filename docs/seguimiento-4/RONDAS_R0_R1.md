# Procedimiento Baseline / R0 / R1

## Causa del fallo previo (R1 0% éxito)

`HOTEL_TIMEOUT_MS` (300) era **menor** que la latencia inyectada (800) **sin fallback**. Toda llamada a Hotel expiraba o encontraba el circuit breaker abierto → el flujo fallaba al 100%. Los errores rápidos se contaban erróneamente como “within SLO”.

## Corrección

1. Timeout + circuit breaker se mantienen.
2. Con `RESILIENCE_ENABLED=true` se activa **fallback de Hotel** (`HOTEL_FALLBACK_ENABLED`, default true): habitación degradada válida (`origenResiliencia: fallback`).
3. El flujo responde `status: success|partial` (HTTP 200).
4. SLO solo sobre solicitudes **exitosas**.
5. Gate rechaza `successRate == 0`.

## Hipótesis a priori

Con timeout+CB+fallback ante latencia Hotel, el flujo mantiene éxito de negocio ≥90% (incluye parciales) y reduce p95 de respuestas exitosas ≥30% vs R0, misma carga e inyección.

## Comando

```powershell
npm run chaos:rounds
npm run chaos:gate
```

## Última evidencia local (mocks)

Fuente: `chaos/results/rounds-latest.json`

| | Baseline | R0 | R1 |
|---|---|---|---|
| successRate | 100% | 100% | 100% |
| partial | 0 | 0 | 24/24 |
| p95SuccessMs | ~124 | ~831 | ~423 (−49%) |
| withinSloOfTotal | alta | 0% | 100% |

Conclusión: **hipótesis SOSTENIDA**.

## k6 real (lab server)

RunId `k6-20261116191039` — mismos stages 15s/45s/15s:

| Round | p95 http | éxito | iterations |
|---|---|---|---|
| baseline | ~11 ms | 100% | 511 |
| r0 | ~820 ms | 100% | 143 |
| r1 | ~11 ms | 100% | 492 |

Archivos: `load/results/{baseline,r0,r1}-k6-20261116191039.json`
