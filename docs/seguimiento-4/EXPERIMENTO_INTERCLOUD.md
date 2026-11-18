# Experimento intercloud — latencia Sports AWS → Hotel OCI

## Requisito de rúbrica

Inyectar latencia en una **llamada saliente** desde Sports (AWS) hacia Hotel (OCI real), medir Baseline/R0/R1 y revertir.

## Mecanismo (ya en código)

| Aspecto | Detalle |
|---|---|
| Punto de inyección | `applyHotelLatencyIfActive` en `hotel.client.ts` **antes** del `fetch` a `HOTEL_API_URL` |
| Destino | URL real `http://149.130.165.30` (no mock) |
| Qué no se toca | Pods/servicios de Samuel (OCI), Cine GCP |
| Activación | `POST /chaos/hotel-latency` + token + `CHAOS_LAB_ENABLED=true` |
| TTL / revert | TTL 120 s + `DELETE` multi-pod (`armed_pods=2`) |
| Evidencia destino | `targetBaseUrl`, `targetsRealHotel`, `injectionPoint` en GET state |
| Resiliencia R1 | timeout **400 ms** + CB + fallback (parcial ≠ full) |
| Timeout vs 800 ms | La inyección corre **dentro** de `withTimeout`: 800 > 400 ⇒ R1 corta durante el delay (antes del fetch) |

## Diseño de rondas (acordado)

| Ronda | Latencia | Resiliencia | ConfigMap |
|---|---|---|---|
| Baseline | no armada | **ON** (timeout 2000, fallback on) | `configmap.exp-intercloud-baseline.yaml` |
| R0 | 800 ms | **OFF** | `configmap.exp-intercloud-r0.yaml` |
| R1 | 800 ms | **ON** (timeout 400 + CB + fallback) | `configmap.exp-intercloud-r1.yaml` |
| Restore | off | ON + OTLP + `CHAOS_LAB=false` | `configmap.yaml` |

**Nota histórica:** versiones previas reutilizaban el CM R0 también para Baseline (`RESILIENCE_ENABLED=false`). Eso divergía del diseño acordado (Baseline = steady con resiliencia). Corregido con CM Baseline independiente.

## OpenTelemetry (conservado en todas las rondas)

Misma config no sensible que `configmap.yaml`:

- `OTEL_SERVICE_NAME=sports-api`
- `OTEL_TRACES_EXPORTER=otlp` / `OTEL_METRICS_EXPORTER=otlp`
- `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`
- `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-lab.local:31443`
- `OTEL_EXPORTER_OTLP_CERTIFICATE=/etc/otel/otel-lab-ca.crt`

Secrets sin cambios: `sports-otel-secrets` (headers Basic), `sports-otel-ca` (CA montado en `/etc/otel`). HostAlias `otel-lab.local` en `deployment.yaml`.

## Umbrales a priori (no ajustar a posteriori)

- Disponibilidad R1 (full+partial) ≥ 90%
- p95 R1 ≤ 70% del p95 R0
- Parcial no cuenta como éxito completo
- Latencia inyectada: **800 ms**
- Perfil k6: `load/k6/flujo-profile-shared.js` (15s@2 → 45s@4 → 15s@0)

## Autorización Samuel

**No armar el fallo contra Hotel OCI sin ventana acordada.**

## Comandos

```powershell
# 1) Preparación / dry-run (NO inyecta)
.\scripts\chaos\run_aws_intercloud_rounds.ps1 -BaseUrl "http://3.21.120.51:30080"

# 2) Tras acuerdo con Samuel (SÍ inyecta + restaura siempre en finally)
.\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud -BaseUrl "http://3.21.120.51:30080"
```

Declarativo Chaos Toolkit: `chaos/experiments/hotel-latency-intercloud.yaml`  
Helpers: `scripts/chaos/aws-lab-helpers.sh` (`verify-env-intercloud`, `arm`/`disarm`)

## Cobertura temporal

- Baseline: GET `/chaos/hotel-latency` debe `enabled=false` antes de k6.
- R0/R1: `arm` exige `armed_pods=2`, `targetsRealHotel=true`, TTL restante ≥ 90 s (k6 ≈ 75 s, TTL=120 s).
- Evidencias: `chaos-arm-*`, `chaos-coverage-*`, `chaos-state-*-start/end.json`, `chaos-disarm-*`.
- Rollback: `try/finally` → disarm + `configmap.yaml` aunque falle k6.

## Aborto

- `/health/ready` ≠ 200
- Flujo sin providers OCI/GCP o con mocks
- `targetsRealHotel != true` / `armed_pods != 2`
- TTL restante < 90 s
- OTEL endpoint vacío o distinto al estable

## Evidencias

- Dry-run / live: `docs/seguimiento-4/evidence/aws-intercloud/<RunId>/`
- Mocks previo: `docs/seguimiento-4/evidence/aws-rounds/aws-rounds-20261116215016/`

## Estado

| Ítem | Estado |
|---|---|
| Mecanismo saliente Sports→Hotel | Listo (imagen `4.1.1-ac7b0fd`) |
| CM Baseline / R0 / R1 + OTLP | Listos (locales; apply en live) |
| Perfil k6 compartido | `flujo-profile-shared.js` |
| Dry-run | Sin `-AuthorizeIntercloud` |
| Rondas live vs OCI | **Pendiente autorización Samuel** |
