# Evidencias — integración multicloud real (AWS → OCI → GCP)

**Sports:** http://3.21.120.51:30080  
**Hotel OCI:** http://149.130.165.30  
**Cine GCP:** http://35.239.107.54  

## Resultado

Flujo `GET /api/v2/flujo/1/1/1` → **HTTP 200**, `status=success`, `degraded=false`,  
`providers.hotel.via=upstream` (`149.130.165.30`), `providers.cine.origen=database` (`35.239.107.54`).  
**No** se usó fallback ni mocks.

## Trace ID de correlación

Negocio: `mc-flujo-bb57ce85d4164032`  
- Sports logs: `traceId` + `otelTraceId=c9c0c23c4acddde6703fb5e679d78686`  
- Hotel: eco de `x-trace-id` en respuesta (ver `09-hotel-echo-trace.txt`)  
- Cine: `traceId` en body + `x-trace-id` header (ver `09-cine-echo-trace.txt`)  

Bloqueo OTel backend: `OTEL_EXPORTER_OTLP_ENDPOINT` vacío → Noop exporter. Spans locales sí; no hay Collector compartido entre las tres nubes.

## k6 (AWS real)

230/230 full, failed=0, p95≈320 ms (`11-k6-summary.json`).

## Rollback a mocks

```bash
kubectl apply -f k8s/aws/configmap.lab-mocks.yaml
kubectl -n sports-lab rollout restart deployment/sports-tournaments-api
```
