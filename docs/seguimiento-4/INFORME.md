# Informe Seguimiento #4 — Ingeniería del Caos (Sports / AWS)

**Autor:** Jarrison López  
**Alcance:** Sports Tournaments API como coordinador multicloud  
**Extensión:** ≤ 6 páginas  
**Evidencia:** `evidence/aws-rounds/` (latencia mocks) · `evidence/aws-hotel503/` (HTTP 503 OCI)

## 1. Objetivo y arquitectura

Sports coordina de forma **síncrona y secuencial** Hotel (OCI / Samuel) y Cine (GCP / Daniel) vía `GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId`, propagando `x-trace-id` y W3C `traceparent`.

**Plataforma:** k3s sobre EC2 en `us-east-2` (perfil `sports-chaos`), namespace `sports-lab`, **2 réplicas**, MySQL lab, NodePort `:30080`. Manifiestos en `k8s/aws/`.

**Estado estable:** Sports http://3.21.120.51:30080; Hotel http://149.130.165.30; Cine http://35.239.107.54. Tras experimentos, flujo real: `status=success`, `degraded=false`, Hotel `upstream`, Cine `database`.

**Limitación:** un solo nodo EC2 no aporta HA ante pérdida de la instancia.

## 2. Experimento A — Latencia inyectada (mocks)

| Campo | Valor |
|---|---|
| Fallo | Latencia 800 ms Sports → Hotel (lab) |
| Destino | solo `hotel-mock` en `sports-lab` |
| Resiliencia R1 | timeout 400 + CB + fallback |
| Evidencia | `aws-rounds-20261116215016` |

**Hipótesis:** disponibilidad (full+partial) ≥90% y p95 ≥30% menor vs R0; partial ≠ full.

| | Baseline | R0 | R1 |
|---|---:|---:|---:|
| Iters | 394 | 132 | 330 |
| full / partial / failed % | 100/0/0 | 100/0/0 | 0/100/0 |
| Disponibilidad % | 100 | 100 | 100 |
| p95 (ms) | 111.6 | 980.4 | 516.4 (−47%) |

**Conclusión A:** hipótesis **SOSTENIDA**. R1 prioriza disponibilidad degradada.

## 3. Experimento B — Hotel OCI HTTP 503 (definitivo)

Fallo real en Hotel OCI (Samuel). Sports sin inyección (`CHAOS_LAB_ENABLED=false`). Imagen `4.1.1-ac7b0fd`. Misma carga k6: 15s@2 → 45s@4 → 15s@0. Detalle: `EXPERIMENTO_HOTEL_503.md` + `evidence/aws-hotel503/RESULTADOS_DEFINITIVOS.md`.

**Hipótesis / umbrales a priori:** Baseline full≥95%; R0 error≥90%; R1 availability≥90% y partial≥80% con full≤10%.

| | Baseline | R0 | R1 |
|---|---:|---:|---:|
| RUN_ID | `hotel503-baseline-20261117-003033` | `hotel503-r0-retry-20261117-004150` | `hotel503-r1-retry-20261117-011303` |
| Iters | 289 | 320 | 349 |
| full / partial / failed | 289/0/0 | 0/0/320 | 0/349/0 |
| Disponibilidad | 100% completa | 0% | 100% degradada |
| p95 (ms) | 312.02 | 224.13 | 234.60 |

**Por qué R0 = 100% failed:** `RESILIENCE_ENABLED=false` — sin timeout/CB/fallback; el 503 de Hotel corta el flujo en todas las iters (cobertura completa del fallo).

**Por qué R1 = 100% partial:** resiliencia ON — Hotel 5xx → fallback → Cine OK → HTTP 200 `status=partial`. **HTTP 200 partial no es éxito completo** (`degraded` / dependencia Hotel degradada).

**p95:** R0/R1 similares y menores que Baseline; el 503 es rápido, así que la ganancia de R1 es **disponibilidad**, no latencia.

**CB:** Samuel reportó ~18 llamadas Hotel 503 ante 349 iters R1 (compatible con CB abierto). Activación CB no se afirma con capturas locales Grafana/Prometheus; evidencia Tempo (Sports partial / Hotel 503 / Cine 200) vive en repo Samuel (`e91ab94`).

**Rollback:** 2/2 Ready; resiliencia ON; caos OFF; Hotel/Cine reales; flujo success.

**Ensayos descartados:** R0 `…003625` (44 full); R1 provisional `…010050` (341; 13 full).

**Conclusión B:** hipótesis de **disponibilidad bajo 503** **SOSTENIDA**.

## 4. Observabilidad y dos patrones

Logs con `traceId` / `otelTraceId`. OTLP → Collector OCI. Fix W3C: un solo `traceparent` (Undici). Ver `OTLP_OCI.md`, `evidence/otel-oci/`.

1. **Timeout** Hotel (`HOTEL_TIMEOUT_MS`) — relevante sobre todo bajo latencia.  
2. **Circuit breaker + fallback** — ante timeouts/5xx abre y sirve habitación degradada (`status=partial`).

## 5. Uso de IA (Cursor)

Orquestación AWS, ConfigMaps Hotel 503, clasificación k6 y consolidación de evidencias. No se inventaron capturas Grafana ni se activó caos desde Sports hacia OCI.

## 6. Limitaciones y cierre

- Radio del fallo A: cliente Sports→mock. Fallo B: Hotel OCI real (Samuel).  
- Sin HA multi-nodo; TTL OCI (~120 s) exige activaciones separadas R0/R1.  
- Pendientes: incorporar evidencias Tempo/Grafana de Samuel al expediente común si se comparten; demo de clase; entrega formal del informe.
