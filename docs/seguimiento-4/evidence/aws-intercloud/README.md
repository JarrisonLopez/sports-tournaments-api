# Evidencia intercloud Sports AWS → Hotel OCI

## Estado

| Run | Tipo | Estado |
|---|---|---|
| `aws-intercloud-dryrun-prepared` | Preparación previa | Sin inyección |
| *(pendiente live)* | Baseline/R0/R1 | Requiere `-AuthorizeIntercloud` + ventana Samuel |

Experimento mocks conservado: `../aws-rounds/aws-rounds-20261116215016/`.

## Preflight corregido (local)

| Ítem | Valor |
|---|---|
| Baseline CM | `configmap.exp-intercloud-baseline.yaml` (resiliencia ON, sin fallo armado) |
| R0 / R1 CM | `exp-intercloud-r0` / `exp-intercloud-r1` + **OTLP activo** |
| k6 | `load/k6/flujo-profile-shared.js` |
| Restore | `try/finally` → `configmap.yaml` |
| Imagen | `4.1.1-ac7b0fd` (sin rebuild; bastan ConfigMaps en live) |

## Ejecución autorizada

```powershell
.\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud
```
