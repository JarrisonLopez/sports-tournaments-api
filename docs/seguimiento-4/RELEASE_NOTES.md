# v4.1.1 — Seguimiento #4 (validación y resiliencia real)

## Fixes / mejoras sobre v4.1.0

- Fallback de Hotel + `status: partial` (corrige R1 0% éxito).
- Gate rechaza éxito 0%; fixtures accept/reject.
- Chaos Toolkit ejecutado de verdad (`chaos-toolkit-journal.json`).
- k6 real Baseline/R0/R1 (`load/results/*-k6-20261116191039.json`).
- Lab server sin MySQL para demos locales.
- Vitest `fileParallelism: false` (estabilidad OTel).

## Notas

- AWS sigue **no desplegado** (IaC + docs en `AWS_DEPLOY.md`).
- Docker daemon / kind/k3d no disponibles en esta estación → K8s solo validación estática.
