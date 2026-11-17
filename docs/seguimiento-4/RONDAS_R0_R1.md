# Procedimiento Baseline / R0 / R1

## Hipótesis a priori

Con timeout+CB+fallback ante latencia Hotel, el flujo mantiene **disponibilidad** (full+partial) ≥90% y reduce p95 ≥30% vs R0, misma carga e inyección. **Parcial ≠ éxito completo.**

## AWS k3s (canónico)

```powershell
.\scripts\chaos\run_aws_rounds.ps1 -BaseUrl "http://3.21.120.51:30080"
```

- Config R0/Baseline: `k8s/aws/configmap.exp-r0.yaml` (mocks, caos on, resiliencia off)
- Config R1: `k8s/aws/configmap.exp-r1.yaml` (mocks, caos on, timeout+CB+fallback)
- Restauración: `k8s/aws/configmap.yaml` (OCI+GCP, caos off)
- Helpers multi-pod: `scripts/chaos/aws-lab-helpers.sh`

### Resultados `aws-rounds-20261116215016`

| | Baseline | R0 | R1 |
|---|---:|---:|---:|
| full % | 100 | 100 | 0 |
| partial % | 0 | 0 | 100 |
| failed % | 0 | 0 | 0 |
| disponibilidad % | 100 | 100 | 100 |
| p95 ms | 111.6 | 980.4 | 516.4 (−47%) |
| iters | 394 | 132 | 330 |

Conclusión: **hipótesis SOSTENIDA** (nivel R1 = partial).  
Evidencia: `docs/seguimiento-4/evidence/aws-rounds/aws-rounds-20261116215016/`.

### Lecciones operativas

1. No dejar `env:` hardcodeado en el Deployment: pisa el ConfigMap.  
2. Armar latencia en **todas** las réplicas (estado in-memory).  
3. `ttlMs` ≤ `CHAOS_MAX_TTL_MS` (default 120000).  
4. No inyectar fallos hacia OCI/GCP.

## Local (mocks Node)

```powershell
npm run chaos:rounds
npm run chaos:gate
```

Fuente local: `chaos/results/rounds-latest.json` (no sustituye la evidencia AWS).

## Hotel OCI HTTP 503 (intercloud real)

Rondas definitivas con fallo Samuel: ver `EXPERIMENTO_HOTEL_503.md` y `evidence/aws-hotel503/RESULTADOS_DEFINITIVOS.md`  
(`hotel503-baseline-20261117-003033` / `hotel503-r0-retry-20261117-004150` / `hotel503-r1-retry-20261117-011303`).
