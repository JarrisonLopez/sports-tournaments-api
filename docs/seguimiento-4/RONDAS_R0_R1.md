# Procedimiento Baseline / R0 / R1

## Comando

```powershell
node scripts/chaos/run_rounds.mjs
```

Variables útiles: `CHAOS_HOTEL_LATENCY_MS`, `HOTEL_TIMEOUT_MS`, `CHAOS_ROUND_REQUESTS`, `CHAOS_ROUND_CONCURRENCY`, `CHAOS_SLO_MS`.

## Última ejecución local (mocks, no multicloud)

Fuente: `chaos/results/rounds-latest.json`

| Ronda | p95 (ms) | Éxito | Dentro SLO | Wall (ms) | Notas |
|---|---|---|---|---|---|
| Baseline | ~89 | 100% | 100% | ~115 | Sin fallo |
| R0 | ~828 | 100% | 0% | ~2457 | Latencia 800ms, sin resiliencia |
| R1 | ~311 | 0% | 100% | ~616 | Timeout 300ms + CB |

Conclusión local: hipótesis **parcialmente sostenida** (mejora p95/SLO/saturación; trade-off de éxito de negocio). Diagnóstico y propuesta de mejora (fallback / fallo 5xx) en el JSON.
