# Evidencia intercloud Sports AWS → Hotel OCI

## Estado

| Run | Tipo | Estado |
|---|---|---|
| `aws-intercloud-dryrun-prepared` | Preparación | Listo (sin inyección) |
| *(pendiente)* | Baseline/R0/R1 live | Requiere `-AuthorizeIntercloud` + ventana Samuel |

El experimento con mocks **no se reemplaza**: ver `../aws-rounds/aws-rounds-20261116215016/`.

## Qué demuestra el dry-run

- Sports ready.
- Caos deshabilitado (`enabled=false`).
- Flujo real OCI+GCP `status=success` sin fallback.

## Ejecución autorizada

```powershell
.\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud
```

Recomendado: redesplegar imagen Sports con los campos `targetsRealHotel` / `targetBaseUrl` antes del live run.
