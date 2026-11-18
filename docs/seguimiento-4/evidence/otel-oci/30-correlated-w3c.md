# Evidencia W3C correlacionada (una sola ejecución)

## Aclaración
Los Trace ID distintos del reporte anterior (`d16807…` vs `e1a883…`) eran de **dos ejecuciones distintas** (flujo HTTP real vs probe in-pod), no un bug de contexto en la misma petición.

## Ejecución única
| Campo | Valor |
|---|---|
| runId | `w3c-one-20261116233411` |
| x-trace-id | `w3c-one-20261116233411-flujo` |
| HTTP | 200 |
| status | success |
| Hotel | upstream → OCI real (vía proxy de captura) |
| Cine | database → GCP real (vía proxy de captura) |
| Hora captura Hotel | 2026-11-17T04:35:19.413Z |
| Hora captura Cine | 2026-11-17T04:35:19.642Z |

## Trace / Span IDs (misma ejecución)

| Rol | Trace ID | Span ID |
|---|---|---|
| Sports SERVER | `4d2c23ebdfcb130da2473261057148f1` | `ac8de2d9147b061b` |
| Sports CLIENT Hotel | `4d2c23ebdfcb130da2473261057148f1` | `553769519c1c3bd3` |
| Sports CLIENT Cine | `4d2c23ebdfcb130da2473261057148f1` | `a4d609f324b97dde` |

**Trace IDs idénticos: SÍ**

## Headers enviados
- Hotel: `traceparent: 00-4d2c23ebdfcb130da2473261057148f1-553769519c1c3bd3-01` (`comma=false`)
- Cine: `traceparent: 00-4d2c23ebdfcb130da2473261057148f1-a4d609f324b97dde-01` (`comma=false`)
- `x-trace-id`: `w3c-one-20261116233411-flujo` en ambos
- `tracestate` outbound: no presente en esta captura

## Post-captura
ConfigMap restaurado a Hotel `http://149.130.165.30` / Cine `http://35.239.107.54`. Proxy eliminado. Pods 2/2 Ready. Secrets OTEL presentes.

## Samuel / Daniel
Confirmar en Tempo spans SERVER de Hotel y Cine bajo Trace ID `4d2c23ebdfcb130da2473261057148f1`.
