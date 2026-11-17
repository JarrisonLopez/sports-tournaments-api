# Pedido a Samuel / Daniel — traza W3C unificada

## Causa corregida en Sports

Sports inyectaba `traceparent` **dos veces** (manual en `buildOutboundTraceHeaders` + `UndiciInstrumentation`).
Node serializaba `traceparent: "tp1, tp2"`, inválido para W3C → Hotel/Cine abrían otra traza.

Fix: solo `x-trace-id` manual; Undici inyecta un único `traceparent` del span CLIENT.

## Ejecución real post-fix

| Campo | Valor |
|---|---|
| HTTP | 200 |
| status | success (Hotel upstream, Cine database) |
| x-trace-id | `w3c-fix-20261116232931-flujo` |
| **otelTraceId** | `d16807bbbf8535867ef55c20734c5964` |
| otelSpanId (entrada Sports) | `a156ab43ada8ae8c` |
| service.name | `sports-api` |

## Headers W3C salientes (misma traza, captura en pod)

Trace padre de prueba de outbound: `e1a8833203e8a3d5a057a684b0c04c26`

| Destino | traceparent enviado | x-trace-id |
|---|---|---|
| Hotel OCI | `00-e1a8833203e8a3d5a057a684b0c04c26-fccfb06960732d4e-01` | `w3c-shared` |
| Cine GCP | `00-e1a8833203e8a3d5a057a684b0c04c26-1f8162e49321c747-01` | `w3c-shared` |

- `comma=false` (un solo valor)
- Mismo Trace ID; Span IDs CLIENT distintos
- Flujo live OTLP export sigue activo hacia Collector OCI

## Qué confirmar en Tempo

1. Trace `d16807bbbf8535867ef55c20734c5964` (flujo live) o cualquier traza reciente `sports-api`.
2. Spans SERVER de **Hotel** y **Cine** bajo el **mismo** Trace ID que Sports.
3. Parent de SERVER Hotel/Cine = Span ID del CLIENT Sports correspondiente.

Si Sports envía `traceparent` válido y el SERVER remoto sigue en otra traza → revisar **extract** / instrumentación en Hotel (Samuel) o Cine (Daniel).

Nota: la respuesta HTTP de Cine a veces devuelve `traceparent` con dos valores concatenados; eso es del lado Cine en la respuesta, no del outbound de Sports.
