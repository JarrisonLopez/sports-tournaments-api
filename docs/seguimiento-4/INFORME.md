# Informe Seguimiento #4 — Ingeniería del Caos (Sports / AWS)

**Autor:** Jarrison López  
**Alcance:** Sports Tournaments API como coordinador multicloud  
**Extensión:** ≤ 6 páginas (este documento)  
**Fecha de evidencia local:** ver `chaos/results/rounds-latest.json`

## 1. Objetivo y arquitectura

Sports coordina de forma **síncrona y secuencial** Hotel (OCI / Samuel) y Cine (GCP / Daniel) vía `GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId`, propagando `x-trace-id` y W3C `traceparent`.

**Plataforma elegida:** Kubernetes ligero **k3s sobre una EC2** (no EKS), por costo académico. Manifiestos en `k8s/aws/` con **2 réplicas**, probes, requests/limits y MySQL de laboratorio. **Limitación:** un solo nodo no aporta HA ante pérdida de la EC2.

**Estado AWS:** infraestructura como código lista; **despliegue remoto no verificado** (sin apply autorizado).

## 2. Experimento

| Campo | Valor |
|---|---|
| Fallo | Latencia inyectada Sports → Hotel |
| Herramienta | Chaos Toolkit YAML + runner Node |
| Interruptor propio | `POST/DELETE /chaos/hotel-latency` |
| Métrica | p95, within-SLO, wall-clock, success rate |
| Radio | Solo cliente Hotel en Sports (lab) |
| Aborto | ready≠200 o activate fallido |
| Reversión | DELETE idempotente + TTL |

## 3. Hipótesis

Bajo carga concurrente fija, inyectar latencia degrada p95/SLO (R0). Con **timeout + circuit breaker** (R1) e idéntica carga/fallo, mejora el presupuesto de latencia/saturación frente a R0.

## 4. Resultados locales (mocks HTTP + k6)

**Causa del R1 0% inicial:** timeout (300 ms) < latencia (800 ms) sin fallback → todos los flujos fallaban; el gate no debe aprobar 0% éxito.

**Corrección:** timeout + CB + fallback de Hotel (respuesta parcial válida). SLO solo sobre éxitos.

| Rondas Node | Baseline | R0 | R1 |
|---|---|---|---|
| éxito | 100% | 100% | 100% (parcial) |
| p95Success | ~124 ms | ~831 ms | ~423 ms (−49%) |

| k6 real | Baseline | R0 | R1 |
|---|---|---|---|
| éxito | 100% | 100% | 100% |
| p95 | ~11 ms | ~820 ms | ~11 ms |
| iters | 511 | 143 | 492 |

**Conclusión:** hipótesis **SOSTENIDA** en laboratorio. Evidencia: `chaos/results/rounds-latest.json`, `load/results/*-k6-20261116191039.json`.

**Importante:** no son resultados AWS/OCI/GCP.

## 5. Observabilidad y chaos gate

OTLP configurable; métricas `sports.flujo.*`, timeouts, CB y eventos de caos. Workflow `.github/workflows/chaos-gate.yml` ejecuta tests + R0/R1 mocks y falla si no hay degradación R0 ni mejora R1.

## 6. Uso de IA (Cursor)

**Aportes:** generación de IaC k3s/EC2, clientes/resiliencia, runners de caos, workflow y documentación.  
**Descartado:** EKS por costo; latencia fuera del timeout (bug corregido tras R1 fallida); afirmar despliegue AWS sin apply.

## 7. Pendientes multicloud

URLs reales Hotel/Cine, Grafana de Samuel, apply AWS autorizado, demo con réplicas en EC2 y traza end-to-end entre nubes.
