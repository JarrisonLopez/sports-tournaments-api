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

## 4. Resultados locales (mocks HTTP)

| | Baseline | R0 | R1 |
|---|---|---|---|
| p95 ms | ~89 | ~828 | ~311 |
| Éxito | 100% | 100% | 0% |
| Within SLO | 100% | 0% | 100% |
| Wall ms | ~115 | ~2457 | ~616 |
| Errores R1 | — | — | Timeout + CircuitOpen |

**Conclusión:** hipótesis **parcialmente sostenida**. Las protecciones acotan saturación (p95 −62%, wall −75%, SLO 0%→100%) pero convierten éxitos lentos en errores rápidos ante dependencia *saludable* ralentizada. **Propuesta:** fallback degradado o experimentar con 5xx de Hotel para sostener mejor el éxito de negocio.

**Importante:** estos números son de laboratorio local, **no** de AWS/OCI/GCP.

## 5. Observabilidad y chaos gate

OTLP configurable; métricas `sports.flujo.*`, timeouts, CB y eventos de caos. Workflow `.github/workflows/chaos-gate.yml` ejecuta tests + R0/R1 mocks y falla si no hay degradación R0 ni mejora R1.

## 6. Uso de IA (Cursor)

**Aportes:** generación de IaC k3s/EC2, clientes/resiliencia, runners de caos, workflow y documentación.  
**Descartado:** EKS por costo; latencia fuera del timeout (bug corregido tras R1 fallida); afirmar despliegue AWS sin apply.

## 7. Pendientes multicloud

URLs reales Hotel/Cine, Grafana de Samuel, apply AWS autorizado, demo con réplicas en EC2 y traza end-to-end entre nubes.
