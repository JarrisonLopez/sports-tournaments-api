# Evidencia OTLP Sports AWS → Collector OCI (Samuel)

**Run ID:** `otel-oci-20261116225214`  
**x-trace-id:** `otel-oci-20261116225214-flujo-1`  
**otelTraceId:** `f63bd8efa28b0098ee433175369012f4`

## Hallazgos

| Chequeo | Resultado |
|---|---|
| TCP `157.137.233.183:31443` desde EC2 | OK |
| TLS leaf | `CN=hotel-otel-lab` self-signed (verify error 18 sin CA) |
| SAN / IP | Cert **sin** IP; pods usan `hostAliases` → `hotel-otel-lab` |
| POST `/v1/traces` sin auth | **401 Unauthorized** (Collector vivo; auth requerida) |
| Secrets `sports-otel-secrets` / `sports-otel-ca` | **Ausentes** (pendiente Samuel) |
| Mount `/etc/otel` | Directorio vacío (secret CA opcional aún no aplicado) |
| `HAS_HEADERS` en pods | **no** |
| Flujo multicloud | HTTP 200 `status=success` Hotel OCI + Cine GCP |
| Pods Sports | **2/2 Ready** |
| Exportación OTLP aceptada | **No confirmada** (falta token+CA; 401 ≠ export OK) |

## Pedido a compañeros

- **Samuel:** confirmar spans `service.name=sports-api` / `otelTraceId=f63bd8efa28b0098ee433175369012f4` y entregar `otel-lab-ca.crt` + token Basic.
- **Daniel:** confirmar continuidad `x-trace-id` / `traceparent` en Cine para la misma ejecución.

## Archivos

- `01-collector-connectivity.txt`
- `02-flujo-multicloud.json` / `.txt`
- `03-health-*.txt`
- `04-flujo-logs-trace.txt`
- `05-k8s-status.txt`
- `06-configmap-otel.yaml`
- `07-pods-logs-sanitized.txt`
