# Experimento Hotel OCI HTTP 503 — guía con Samuel

Sports (AWS) se prepara para Baseline / R0 / R1. **Samuel activa el HTTP 503 en Hotel OCI** en la ventana acordada. Sports **no** inyecta latencia (`CHAOS_LAB_ENABLED=false`).

## Precondiciones (antes de la ventana)

1. Imagen Sports con fallback ante Hotel 5xx desplegada (fix `isHotelRecoverableError` incluye `HotelRequestError` ≥500).
2. Rebuild + rollout en k3s (misma tag `4.1.1` o la que uséis):

```powershell
# Desde la raíz del repo (requiere PEM + SSH al nodo)
.\infra\aws\scripts\post-apply-bootstrap.ps1
# o el procedimiento de rebuild/import que ya uséis en el lab
```

3. Verificación local (sin OCI):

```powershell
node scripts/chaos/verify_hotel_503_local.mjs
```

4. Samuel confirma ventana. **No** armar 503 antes.

## Interruptores (efectivos en código)

| Variable | Baseline | R0 | R1 | Qué controla |
|---|---|---|---|---|
| `RESILIENCE_ENABLED` | `true` | `false` | `true` | Master: timeout + circuit breaker (+ fallback si también FB) |
| `HOTEL_FALLBACK_ENABLED` | `true` | `false` | `true` | Solo con resiliencia ON: habitación degradada ante timeout/CB/5xx |
| `HOTEL_TIMEOUT_MS` | `2000` | `2000` (inactivo) | `2000` | AbortSignal; con 503 rápido suele no dispararse |
| `CHAOS_LAB_ENABLED` | `false` | `false` | `false` | Lab latencia Sports; **siempre false** en este experimento |

R0 desactiva timeout, CB y fallback. R1 los activa; ante HTTP 503 el fallback responde `status=partial` (`origenResiliencia=fallback`). Un HTTP 200 partial **no** es disponibilidad completa.

## Comandos exactos (ventana)

Sustituye `RUN_ID` por un id único, p. ej. `hotel503-20261117-1`.

### 0) Estado / pods Ready

```powershell
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode status
```

### 1) Baseline (Hotel normal, resiliencia activa)

```powershell
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode baseline

$env:BASE_URL="http://3.21.120.51:30080"
$env:TORNEO_ID="1"; $env:HABITACION_ID="1"; $env:PELICULA_ID="1"
$env:ROUND="baseline"; $env:RUN_ID="hotel503-<ID>"
k6 run load/k6/flujo-profile-shared.js
```

Confirmar muestra: HTTP 200, `status=success`, `degraded=false`, providers Hotel OCI + Cine GCP.

### 2) Preparar R0 (resiliencia OFF) — aún sin 503

```powershell
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode r0
```

Esperado en ambos pods: `CHAOS_LAB_ENABLED=false`, `RESILIENCE_ENABLED=false`, `HOTEL_FALLBACK_ENABLED=false`, URLs reales.

### 3) Samuel activa HTTP 503 en Hotel → k6 R0

```powershell
$env:BASE_URL="http://3.21.120.51:30080"
$env:TORNEO_ID="1"; $env:HABITACION_ID="1"; $env:PELICULA_ID="1"
$env:ROUND="r0"; $env:RUN_ID="hotel503-<ID>"
k6 run load/k6/flujo-profile-shared.js
```

Esperado R0: alta tasa `failed` (flujo no completa).

### 4) Preparar R1 (resiliencia ON) — 503 sigue activo

```powershell
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode r1
```

Esperado: `RESILIENCE_ENABLED=true`, `HOTEL_FALLBACK_ENABLED=true`, `CHAOS_LAB_ENABLED=false`.

### 5) k6 R1

```powershell
$env:BASE_URL="http://3.21.120.51:30080"
$env:TORNEO_ID="1"; $env:HABITACION_ID="1"; $env:PELICULA_ID="1"
$env:ROUND="r1"; $env:RUN_ID="hotel503-<ID>"
k6 run load/k6/flujo-profile-shared.js
```

Esperado R1: mayoría `partial` (200 degradado), no `full`. Guardar JSON `load/results/r1-<RUN_ID>.json`.

### 6) Rollback (config estable)

```powershell
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode rollback
```

Samuel desactiva el 503 en OCI. Smoke:

```powershell
curl.exe -s -D - "http://3.21.120.51:30080/api/v2/flujo/1/1/1" -H "x-trace-id: post-503-rollback-1"
```

### 7) Verificar 2/2 Ready

```powershell
.\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode status
# o en el nodo:
# sudo kubectl -n sports-lab get deploy,pods -l app=sports-tournaments-api
```

## Perfil k6

Archivo: `load/k6/flujo-profile-shared.js`

- 15s → 2 VU; 45s → 4 VU; 15s → 0 VU; sleep 0.3 s
- Mismo endpoint las tres rondas
- Clasificación: `flujo_full` / `flujo_partial` / `flujo_failed` + `ROUND` + `RUN_ID` en summary JSON

### Umbrales k6 embebidos (runner)

`http_req_failed rate<0.95`, `p(95)<15000`, `flujo_available rate>0.05` — **demasiado permisivos** para validar hipótesis; solo evitan abortar el runner bajo R0.

### Umbrales a priori (evaluación post-run — no relajar después)

| Ronda | Criterio |
|---|---|
| Baseline | `fullSuccessRate ≥ 0.95`, `errorRate ≤ 0.05`, `partialRate ≈ 0` |
| R0 (503) | `errorRate ≥ 0.90`, `fullSuccessRate ≤ 0.05` |
| R1 (503) | `availabilityRate (full+partial) ≥ 0.90`, `partialRate ≥ 0.80`, `fullSuccessRate ≤ 0.10` |
| Comparación | p95 R1 ≤ p95 R0 (si R0 tiene respuestas lentas/errores); **partial ≠ full** |

## Evidencias a guardar

- Salida `set_aws_hotel503_mode.ps1` (verify + k8s snapshot) por modo
- `load/results/{baseline,r0,r1}-<RUN_ID>.json` + stdout k6
- Muestra curl Baseline / R0 / R1 / post-rollback (headers + body)
- Confirmación Samuel: inicio/fin del 503
- Carpeta sugerida: `docs/seguimiento-4/evidence/aws-hotel503/<RUN_ID>/`

## Aborto / no hacer

- No mezclar con `POST /chaos/hotel-latency` ni ConfigMaps `exp-intercloud-*` / `exp-r0` (mocks)
- No `terraform destroy` / no push
- Si falla el apply de modo: `-Mode rollback`
