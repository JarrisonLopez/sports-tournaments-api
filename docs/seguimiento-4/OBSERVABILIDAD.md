# Observabilidad — Seguimiento #4 (Sports)

## Exportación

Sports exporta traces y métricas OTLP/HTTP cuando:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Samuel prepara Grafana compartido. Sports no embebe dashboards propietarios; exporta a Collector.

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
