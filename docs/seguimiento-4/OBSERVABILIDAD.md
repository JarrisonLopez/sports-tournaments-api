# Observabilidad — Seguimiento #4 (Sports)

## Exportación

Sports exporta traces y métricas OTLP/HTTP cuando hay endpoint (si falta → Noop / sin readers):

```text
OTEL_SERVICE_NAME=sports-api
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://hotel-otel-lab:31443
OTEL_EXPORTER_OTLP_CERTIFICATE=/etc/otel/otel-lab-ca.crt
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic …   # Secret, no ConfigMap
```

Lab compartido OCI (Samuel): ver `OTLP_OCI.md`. Rollback: `k8s/aws/configmap.otel-rollback.yaml`.

## Señales del flujo evaluado

| Señal | Instrumento | Uso |
|---|---|---|
| Total solicitudes flujo | `sports.flujo.requests` | Baseline / R0 / R1 |
| Éxitos | `sports.flujo.success` | Tasa de éxito |
| Errores | `sports.flujo.errors` | Fallos / CB open / timeouts |
| Duración | `sports.flujo.duration` (s) | p95 del flujo |
| Timeouts Hotel | `sports.hotel.timeouts` | Evidencia timeout |
| Estado CB | `sports.hotel.circuit_breaker.state` | closed/half_open/open |
| Transiciones CB | `sports.hotel.circuit_breaker.transitions` | Evidencia resiliencia |
| Eventos caos | `sports.chaos.fault.events` | start/end/abort/expire |
| Trace ID negocio | atributo `sports.trace_id` + header `x-trace-id` | Correlación |
| Trace OTel | `traceparent` / spans `flujo.multicloud`, `hotel.get_habitacion`, `cine.get_pelicula` | Trazas distribuidas |

Las métricas RED HTTP existentes (`http.server.*`) se conservan.

## Opción local

Para laboratorio sin Grafana:

1. Collector local (manifiesto `k8s/otel-collector` o Compose).
2. O `OTEL_EXPORTER_OTLP_ENDPOINT` vacío → Noop (sin inventar series).

Los resultados R0/R1 se persisten también como JSON en `chaos/results/` generados por el runner local.

## Tablero sugerido (Grafana de Samuel)

Paneles mínimos:

1. Rate `sports.flujo.requests`
2. Success ratio
3. Histograma/p95 `sports.flujo.duration`
4. `sports.hotel.timeouts`
5. Estado CB
6. Explore traces filtrando `sports.trace_id`
