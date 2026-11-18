# v4.2.0 — Seguimiento #4 (cierre Chaos AWS)

## Resumen

Cierre de la entrega individual Sports AWS: experimentos reales documentados, infraestructura restaurada, Chaos Gate CI en verde, informe ≤6 páginas.

## Cambios respecto a 4.1.x

- Experimento **Hotel OCI HTTP 503** (Samuel): Baseline/R0/R1 definitivos + rollback (`evidence/aws-hotel503/`).
- Experimento **latencia intercloud** Sports→Hotel OCI: live `aws-intercloud-live-20261117191113` (R1 100% partial, p95 −49,24% vs R0).
- Verificación **Cine GCP** (Daniel): integración multicloud + evidencia W3C/OTLP post-despliegue (`otel-oci/31-*`).
- OTLP hacia Collector OCI (TLS/Basic), fix `traceparent` único, perfil k6 compartido.
- Chaos Gate: fixtures PASS/FAIL/invalid; workflow distingue mocks CI de experimentos cloud.
- Informe, README, demo sin inyección y docs de release alineados.

## Chaos Gate (CI)

- Workflow: `.github/workflows/chaos-gate.yml` (lab local con mocks; **no** arma AWS/OCI/GCP).
- Run success: https://github.com/JarrisonLopez/sports-tournaments-api/actions/runs/44204457598

## Lab AWS

- Desplegado y usado para mediciones: k3s/EC2 `us-east-2`, Sports `http://3.21.120.51:30080`.
- Post-experimentos: caos desarmado, providers Hotel OCI + Cine GCP, flujo `success`.

## No incluido en este release

- Republicar tags `v4.1.0` / `v4.1.1`.
- Afirmar circuit breaker OPEN sin métrica explícita.
- Evidencias Tempo/Grafana internas de Samuel (viven en su repo; se citan por referencia).
