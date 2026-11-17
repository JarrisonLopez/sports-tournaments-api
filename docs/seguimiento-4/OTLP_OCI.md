# Conexión OTLP Sports (AWS) → Collector OCI (Samuel)

## Endpoint lab

| Campo | Valor |
|---|---|
| Collector | `https://157.137.233.183:31443` |
| Hostname TLS | SAN: `DNS:otel-lab.local`, `IP:157.137.233.183` (CN `hotel-otel-lab` no basta para Node/curl) |
| URL en pods | `https://otel-lab.local:31443` vía `hostAliases` |
| Protocolo | OTLP HTTP (`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`) |
| Trazas | `{endpoint}/v1/traces` (añadido por exporter) |
| Métricas | `{endpoint}/v1/metrics` |
| Auth | HTTP Basic usuario `otel-lab` |
| CA | Secret `sports-otel-ca` → `/etc/otel/otel-lab-ca.crt` |

## Variables (ConfigMap)

```text
OTEL_SERVICE_NAME=sports-api
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-lab.local:31443
OTEL_EXPORTER_OTLP_CERTIFICATE=/etc/otel/otel-lab-ca.crt
```


Headers Basic **solo** en Secret `sports-otel-secrets`:

```text
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(otel-lab:TOKEN)>
```

No desactivar `NODE_TLS_REJECT_UNAUTHORIZED`. El exporter Node 0.222 lee headers y CA desde env.

## Aplicar credenciales (cuando Samuel las entregue)

```powershell
.\scripts\otel\apply-oci-collector-secrets.ps1 -Token $env:OTEL_LAB_TOKEN -CaCertPath .\otel-lab-ca.crt
.\scripts\otel\verify-oci-collector.ps1 -EvidenceDir docs\seguimiento-4\evidence\otel-oci
```

## Rollback OTLP (sin tocar Hotel/Cine)

```powershell
# vía SSH al nodo k3s:
Get-Content k8s\aws\configmap.otel-rollback.yaml -Raw | ssh ... "sudo kubectl apply -f -"
ssh ... "sudo kubectl -n sports-lab rollout restart deployment/sports-tournaments-api"
```

## Verificación de traza distribuida

1. `GET http://3.21.120.51:30080/api/v2/flujo/1/1/1` con `x-trace-id` único.
2. Logs Sports: `traceId` + `otelTraceId`.
3. Pedir a Samuel (Hotel) y Daniel (Cine) confirmar spans / `traceparent` / `x-trace-id`.
4. Pedir a Samuel confirmar recepción en Collector/Grafana (`service.name=sports-api`).

`x-trace-id` en la respuesta HTTP **no** implica por sí solo traza distribuida completa ni exportación OTLP exitosa.
