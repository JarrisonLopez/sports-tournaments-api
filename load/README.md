# Generador de carga k6 — perfil fijo

## Perfil (idéntico en Baseline / R0 / R1)

| Parámetro | Valor |
|---|---|
| Executor | `ramping-vus` |
| Escalones | 0→2 (15s), 2→4 (45s), 4→0 (15s) |
| Sleep | 0.3 s |
| Thresholds | `http_req_failed rate<0.95`, `p(95)<15000`, `flujo_available rate>0.05` |
| Script canónico | `load/k6/flujo-profile.js` |
| Copia compartible | `load/k6/flujo-profile-shared.js` (mismos stages/thresholds) |
| Endpoint | `GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId` |

No modificar el perfil entre R0 y R1.

## PowerShell

```powershell
New-Item -ItemType Directory -Force -Path load\results | Out-Null
$env:RUN_ID = "local-$(Get-Date -Format yyyyMMddHHmmss)"
$env:BASE_URL = "http://127.0.0.1:8080"
$env:ROUND = "baseline"
k6 run load\k6\flujo-profile.js

# Ronda 0 / 1
$env:ROUND = "r0"; k6 run load\k6\flujo-profile.js
$env:ROUND = "r1"; k6 run load\k6\flujo-profile.js
```

## Docker (si k6 no está instalado)

```powershell
docker run --rm -e BASE_URL=http://host.docker.internal:8080 -e ROUND=baseline -e RUN_ID=docker-1 -v ${PWD}/load:/scripts grafana/k6:0.54.0 run /scripts/k6/flujo-profile.js
```

## Reutilización por compañeros

Cambiar solo `BASE_URL` y los IDs. Conservar stages y thresholds del archivo, o copiar el script adaptando el path del endpoint.
