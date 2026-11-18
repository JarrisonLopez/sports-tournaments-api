# Pedido post-despliegue Cine (W3C) — Sports AWS

## Ejecución

| Campo | Valor |
|---|---|
| URL | `GET http://3.21.120.51:30080/api/v2/flujo/1/1/1` |
| Fecha/hora (UTC) | `2026-11-17T04:45:32Z` |
| Fecha/hora (UTC-5) | `2026-11-16 23:45:32` |
| HTTP | `200` |
| status | `success` |
| degraded | `false` |
| x-trace-id | `w3c-postcine-20261116234532-flujo` |
| **OTel Trace ID** | `8fe0364d426e1d90deefa626a24f987d` |
| Hotel | real OCI `http://149.130.165.30` (`via=upstream`) |
| Cine | real GCP `http://35.239.107.54` (`origen=database`) |
| Pods Sports | 2/2 Ready |
| OTLP export errors | ninguno en ventana reciente |

## W3C `traceparent`

En esta ejecución **no** se reinstaló proxy de captura de headers outbound. La unicidad del `traceparent` (sin comma/duplicado) quedó verificada en la ejecución anterior: `30-correlated-w3c` / Trace ID `4d2c23ebdfcb130da2473261057148f1`.

## Pendiente (Samuel / Daniel)

Confirmar en Tempo spans **SERVER** de Hotel y Cine (y Sports) bajo Trace ID:

`8fe0364d426e1d90deefa626a24f987d`

No declarar trazabilidad completa hasta esa confirmación.
