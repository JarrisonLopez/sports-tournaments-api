# Guion de sustentación — Seguimiento #4 (sin inyección de caos)

Demostración corta y reproducible. **No** armar latencia, **no** cambiar modos Hotel 503, **no** pasar `-AuthorizeIntercloud`.

## 1. Arquitectura y réplicas (manifiestos)

Mostrar `k8s/aws/deployment.yaml` (`replicas: 2`, probes) y el índice `docs/seguimiento-4/README.md` (Sports AWS → Hotel OCI → Cine GCP).

Opcional (solo lectura, si el lab sigue up):

```powershell
kubectl -n sports-lab get deploy,pods -l app=sports-tournaments-api
```

## 2. Health + flujo multicloud (sin caos)

```powershell
curl http://3.21.120.51:30080/health/ready
curl -H "x-trace-id: demo-sustentacion-1" http://3.21.120.51:30080/api/v2/flujo/1/1/1
```

Esperado: ready OK; flujo `status=success`, `degraded=false`, Hotel `upstream`, Cine `database`.
Si el lab no está reachable: usar cuerpos guardados en evidencias (`05-after-flujo.body`, `post-consolidation-flujo.json`).

## 3. Evidencias JSON (experimentos reales)

| Experimento | Archivo a abrir |
|---|---|
| Hotel HTTP 503 | `docs/seguimiento-4/evidence/aws-hotel503/RESULTADOS_DEFINITIVOS.md` + `runs-definitivos/` |
| Latencia intercloud | `docs/seguimiento-4/evidence/aws-intercloud/aws-intercloud-live-20261117191113/comparison.json` |
| Cine / W3C post-deploy | `docs/seguimiento-4/evidence/otel-oci/31-pedido-companeros.md` |
| Rollback intercloud | `…/05-after-flujo.body` + `05-after-restore-k8s.txt` |

Mensaje clave: R1 = **disponibilidad degradada (partial)**, no éxito completo.

## 4. Chaos Gate (CI sintético ≠ experimentos cloud)

- Workflow: `.github/workflows/chaos-gate.yml` — mocks HTTP + fixtures; **no** arma caos en AWS/OCI/GCP.
- Run aprobado: https://github.com/JarrisonLopez/sports-tournaments-api/actions/runs/44204457598

Local (opcional, sin cloud):

```powershell
npm run chaos:rounds
npm run chaos:gate
npm run chaos:gate:test
```

## 5. Trazabilidad / observabilidad

- Mostrar `x-trace-id` / `otelTraceId` en `evidence/otel-oci/31-summary.txt` o respuesta live.
- Pedido Tempo a compañeros: `31-pedido-companeros.md` / confirmaciones Samuel (803≈802 ms R0; ~400 ms R1 sin HTTP Hotel).
- **No** afirmar circuit breaker OPEN sin métrica explícita.

## 6. Informe y versión

- Informe ≤6 páginas: `docs/seguimiento-4/INFORME.md`
- SemVer propuesto de cierre: **v4.2.0** (`docs/seguimiento-4/RELEASE.md`)

## Prohibido en la demo de cierre

- `POST /chaos/hotel-latency` / `DELETE` de armado
- `run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud`
- `set_aws_hotel503_mode.ps1` con `baseline|r0|r1`
- Terraform / kubectl apply / rollout
