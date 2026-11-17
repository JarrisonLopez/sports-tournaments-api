# Evidencia OTLP Sports AWS → Collector OCI (cerrado)

## Resultado

| Chequeo | Resultado |
|---|---|
| Secrets `sports-otel-secrets` / `sports-otel-ca` | Creados y montados |
| CA en pods `/etc/otel/otel-lab-ca.crt` | Presente (~1166 bytes) |
| HAS_HEADERS | yes (ambos pods) |
| TLS Node `otel-lab.local` + CA | **authorized=true** |
| SAN del cert | `DNS:otel-lab.local`, `IP:157.137.233.183` |
| POST `/v1/traces` auth+TLS | **HTTP 200** |
| POST `/v1/metrics` auth+TLS | **HTTP 200** |
| POST sin auth | **401** |
| Flujo multicloud | **200 status=success** Hotel upstream + Cine database |
| Pods | **2/2 Ready** |
| Endpoint configurado | `https://otel-lab.local:31443` |

## Trace de prueba

- runId: `otel-oci-live-20261116230837`
- x-trace-id: `otel-oci-live-20261116230837-flujo-1`
- otelTraceId: `ad97747b16a40a3c738b6591e1f59309`
- otelSpanId: `354377a4a5339766`

## Pendiente externo

Samuel debe confirmar en Tempo/Grafana la recepción de `service.name=sports-api` y el `otelTraceId` anterior (Sports ya exporta con TLS+Basic OK).

## Nota TLS

No usar `hotel-otel-lab` como host OTLP: está en CN pero **no** en SAN. Usar `otel-lab.local`.
