# Evidencia OTLP + W3C — Sports AWS → OCI Collector

## Estado

| Área | Resultado |
|---|---|
| OTLP export TLS+Basic | OK (traces/metrics 200) |
| Propagación W3C | **Corregida** (un solo `traceparent` vía Undici) |
| Flujo multicloud | 200 success Hotel OCI + Cine GCP |
| Pods | 2/2 Ready |

## Bug W3C

Doble inyección `propagation.inject` + Undici → `traceparent: "a, b"` inválido.
Fix en `src/clients/http-trace.ts`: solo `x-trace-id`.

## Trace live post-fix

- x-trace-id: `w3c-fix-20261116232931-flujo`
- otelTraceId: `d16807bbbf8535867ef55c20734c5964`
- Ver `21-flujo-w3c-*`, `22-w3c-shared-parent-outbound.txt`, `23-pedido-samuel-w3c.md`

## Última verificación post-despliegue Cine (31)

- x-trace-id: `w3c-postcine-20261116234532-flujo`
- otelTraceId: `8fe0364d426e1d90deefa626a24f987d`
- HTTP 200 / success / degraded=false / Hotel OCI + Cine GCP reales / pods 2/2
- Ver `31-*` (pedido: `31-pedido-companeros.md`)
