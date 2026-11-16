# v4.1.0 — Seguimiento #4 Chaos Engineering (AWS)

## Highlights

- Orquestación multicloud **secuencial** Hotel → Cine con tracing.
- Infra **k3s/EC2** + manifiestos K8s (2 réplicas, probes, resources).
- Interruptor de latencia Sports→Hotel + experimento Chaos Toolkit/runner.
- **Timeout** y **circuit breaker** conmutables vía `RESILIENCE_ENABLED`.
- Perfil **k6** fijo reproducible.
- Chaos gate CI con R0/R1 sobre mocks HTTP.
- Evidencia local en `chaos/results/rounds-latest.json`.

## Notas

- Despliegue AWS no incluido en esta release hasta apply autorizado.
- Integración real OCI/GCP pendiente de URLs de compañeros.
