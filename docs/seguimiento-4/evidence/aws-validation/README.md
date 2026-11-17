# Evidencias AWS — validación Seguimiento #4

**Entorno:** k3s sobre EC2 `c7i-flex.large` en `us-east-2` (perfil `sports-chaos`).  
**URL:** http://3.21.120.51:30080  
**Distinción:** las rondas R0/R1 previas en `chaos/results/` son **locales con mocks**. Este directorio es **AWS real**.

## Resumen

| Chequeo | Resultado |
|---------|-----------|
| Réplicas Sports | 2/2 Ready, restarts=0 en pods actuales |
| Versión | `x-api-version: 4.1.1` / imagen `sports-tournaments-api:4.1.1` |
| HTTP live/ready/root | 200 |
| Torneo sintético | id=1 creado (POST 201) |
| Flujo baseline | `status=success` (hotel/cine mocks **en sports-lab**, no OCI/GCP) |
| Caos por defecto | `CHAOS_LAB_ENABLED=false`; POST arm → 403 |
| Fallo lab + fallback | latencia Hotel armada → `status=partial` + `origenResiliencia=fallback` |
| Recuperación | disarm → `status=success` |
| k6 AWS moderado | 290/290 full, failed=0, p95≈210 ms |
| OTel export | endpoint vacío → Noop (traceId en logs HTTP) |
| Resiliencia en imagen | `timeout.js`, `circuit-breaker.js`, `hotel-fallback.js` presentes |
| PEM / tfstate | PEM fuera del repo; `*.tfstate` / `*.tfvars` ignorados por Git |

## Archivos clave

- `03-restarts-image.txt`, `13-final-k8s.txt` — Kubernetes  
- `06-*.txt`, `07-flujo-baseline.txt`, `09-flujo-fault-*.txt`, `10-flujo-recovery.txt` — HTTP  
- `14-k6-summary.json` — k6 AWS  
- `11-logs-sample.txt`, `12-resilience-otel-runtime.txt` — observabilidad / resiliencia  
- `00-repo-secrets.txt` — protección de secretos (sin material de clave)
