# Deploy Sports AWS — fix HTTP 503 fallback (`ac7b0fd`)

| Campo | Valor |
|---|---|
| SHA | `ac7b0fd` (incluye `f2de01b`) |
| Imagen | `sports-tournaments-api:4.1.1-ac7b0fd` |
| Digest containerd | `sha256:60dd46aa4939dcb6cfd30efaad0bcdb41a8ca0607a9f5e228cf13686b2b3e7e8` |
| ImageID pods | `sha256:7268e22f2440119f7bbff0c3e30b6d72182d72cd83b691ac1ff412d9e5a14480` |
| Imagen anterior (rollback) | `sports-tournaments-api:4.1.1` → `sha256:f238a7efda1a8219beafe62e4bac6c85a41b90910205828d741cfaa773f8a06c` |
| Namespace | `sports-lab` |
| Ready | **2/2** |

## Procedimiento

Build en EC2 + `k3s ctr images import` (mismo flujo que `post-apply-bootstrap.ps1`), luego solo:

```text
kubectl -n sports-lab set image deployment/sports-tournaments-api \
  sports-tournaments-api=sports-tournaments-api:4.1.1-ac7b0fd
```

No se recreó EC2/k3s/MySQL/Terraform.

## Verificaciones

| Check | Resultado |
|---|---|
| `/health/live` | 200 |
| `/health/ready` | 200 |
| `/api/v2/flujo/1/1/1` | 200 `status=success` `degraded=false` |
| Hotel | `http://149.130.165.30` via `upstream` |
| Cine | `http://35.239.107.54` origen `database` |
| Fallback en steady | no |
| Fix en imagen | `HotelRequestError` + `status >= 500` en `dist/resilience/hotel-fallback.js` (ambos pods) |
| W3C | sin `propagation.inject` en `http-trace.js`; log con `otelTraceId=657f70f0…` |
| OTLP | `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-lab.local:31443` en ambos pods |
| Caos | `CHAOS_LAB_ENABLED=false` |
| Resiliencia baseline | `RESILIENCE_ENABLED=true` `HOTEL_FALLBACK_ENABLED=true` |

**No** se validó R1 contra Hotel OCI real (Samuel aún no activa 503).

## Rollback

Ver `12-rollback-commands.txt`.
