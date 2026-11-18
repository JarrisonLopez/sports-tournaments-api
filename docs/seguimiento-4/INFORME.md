# Informe Seguimiento #4 — Ingeniería del Caos (Sports / AWS)

**Autor:** Jarrison López
**Alcance:** Sports Tournaments API como coordinador multicloud
**Extensión:** ≤ 6 páginas
**Evidencias:** `evidence/aws-hotel503/` · `evidence/aws-intercloud/aws-intercloud-live-20261117191113/` · `evidence/otel-oci/` · `evidence/multicloud-real/` · `evidence/aws-rounds/` (lab mocks)

## 1. Objetivo y arquitectura

Sports orquesta de forma **síncrona y secuencial** Hotel (OCI / Samuel) → Cine (GCP / Daniel) en
`GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId`, propagando `x-trace-id` y W3C `traceparent`.

| Capa | Detalle |
|---|---|
| Plataforma | k3s sobre EC2 `us-east-2` (perfil `sports-chaos`), ns `sports-lab`, **2 réplicas**, MySQL lab, NodePort `:30080` |
| Manifiestos | `k8s/aws/` · imagen `sports-tournaments-api:4.1.1-ac7b0fd` |
| URLs estables | Sports `http://3.21.120.51:30080` · Hotel `http://149.130.165.30` · Cine `http://35.239.107.54` |
| Perfil k6 | `load/k6/flujo-profile-shared.js` — 15s@2 → 45s@4 → 15s@0 |

**Estado post-experimentos:** flujo real `status=success`, `degraded=false`, Hotel `upstream`, Cine `database`.
**Limitación de plataforma:** un solo nodo EC2 no aporta HA ante pérdida de la instancia.

## 2. Hipótesis y métricas objetivo

| Experimento | Hipótesis / umbrales a priori |
|---|---|
| Hotel OCI HTTP 503 | Baseline full≥95%; R0 error≥90%; R1 availability≥90% y partial≥80% (full≤10%); partial ≠ full |
| Latencia intercloud OCI | R1 availability (full+partial) ≥90%; p95 R1 ≤70% del p95 R0; partial ≠ full; latencia 800 ms; timeout R1 400 ms |
| Cine (Daniel) | Tras despliegue/ajuste Cine, el flujo multicloud permanece success con providers reales y traza W3C/OTLP usable |
| Lab mocks (referencia) | Misma lógica de disponibilidad/p95; radio limitado a `hotel-mock` |

Clasificación k6: **full** = éxito completo; **partial** = HTTP 200 degradado (fallback Hotel); **failed** = error de flujo.
**Partial no cuenta como éxito de negocio completo.**

## 3. Experimento — Hotel OCI HTTP 503 (Samuel)

Fallo real en Hotel OCI. Sports **sin** inyección local (`CHAOS_LAB_ENABLED=false`). Coordinación con Samuel (TTL ~120 s → activaciones **separadas** R0/R1).
Detalle: `EXPERIMENTO_HOTEL_503.md` · `evidence/aws-hotel503/RESULTADOS_DEFINITIVOS.md`.

| | Baseline | R0 definitiva | R1 definitiva |
|---|---:|---:|---:|
| RUN_ID | `hotel503-baseline-20261117-003033` | `hotel503-r0-retry-20261117-004150` | `hotel503-r1-retry-20261117-011303` |
| Iters | 289 | 320 | 349 |
| full / partial / failed | 289 / 0 / 0 | 0 / 0 / 320 | 0 / 349 / 0 |
| Disponibilidad | 100% completa | 0% | **100% degradada** |
| p95 (ms) | 312.02 | 224.13 | 234.60 |

- **R0 100% failed:** resiliencia OFF — el 503 corta el flujo en todas las iters (cobertura completa del fallo en esa ventana).
- **R1 100% partial:** resiliencia ON — Hotel 5xx → fallback → Cine OK → HTTP 200 `status=partial`.
- **p95:** R0/R1 similares y menores que Baseline; el 503 es rápido → la ganancia de R1 es **disponibilidad**, no latencia.
- **Tempo (Samuel):** Sports partial / Hotel 503 / Cine 200; ~18 llamadas Hotel 503 en R1 (repo Samuel, p. ej. `e91ab94`).
- **Circuit breaker:** el conteo bajo de llamadas es *compatible* con CB abierto; **no** se afirma transición a OPEN sin serie/métrica local explícita.
- Ensayos descartados: R0 `…003625` (44 full); R1 provisional `…010050` (13 full).
**Conclusión:** hipótesis de disponibilidad bajo 503 **SOSTENIDA**.

## 4. Experimento — Cine GCP (Daniel)

Sports **no** inyecta fallo en Cine. El aporte de esta entrega es la **integración y verificación post-despliegue** coordinada con Daniel:

1. Cableado real Sports→Cine (`evidence/multicloud-real/`, providers `CINE_API_URL=http://35.239.107.54`).
2. En Hotel 503 R1, Cine permanece operativo (partial con película OK).
3. Verificación W3C/OTLP post-Cine: `evidence/otel-oci/31-*` — HTTP 200, `status=success`, `degraded=false`, Hotel OCI + Cine GCP, pods 2/2; Trace ID `8fe0364d426e1d90deefa626a24f987d` (`31-pedido-companeros.md`).

Confirmación de spans SERVER de Cine en Tempo queda del lado Daniel/Samuel cuando aplique; Sports aporta el cliente correlacionado y el pedido.

## 5. Experimento — Latencia intercloud real (Sports → Hotel OCI)

Inyección en el **cliente saliente** de Sports hacia Hotel OCI real (`applyHotelLatencyIfActive` antes del `fetch`). No se tocan pods de Samuel ni Cine.
Evidencia canónica: `evidence/aws-intercloud/aws-intercloud-live-20261117191113/` (`comparison.json`).

| | Baseline | R0 | R1 |
|---|---:|---:|---:|
| Completas (full) | 273 | 113 | 0 |
| Parciales | 0 | 0 | **273** |
| Fallidas | 0 | 0 | 0 |
| Disponibilidad | 100% completa | 100% completa (lenta) | **100% degradada** |
| p95 (ms) | 360,13 | 1.230,35 | **624,50 (−49,24%)** |

**Cobertura temporal (sin inventar relojes de k6):** el orquestador arma latencia → corre k6 → desarma (TTL ~120 s + `DELETE` multi-pod); Baseline sin fallo; R0/R1 con 800 ms armados en ambas réplicas; restore final a `configmap.yaml`. La cobertura se sustenta por activación, TTL, orden del script y desactivación (`chaos-arm-*`, `chaos-disarm-*`, `chaos-coverage-*`, `05-after-*`).

**Tempo (Samuel, confirmado):**
- R0: espera ≈ **802 ms** antes de contactar Hotel.
- R1: fallback tras espera ≈ **400 ms** **sin** llamada HTTP a Hotel (timeout dentro de la inyección: 800 > 400).
- Cine permanece operativo.

**Circuit breaker:** implementado en R1 junto a timeout/fallback; **no** se afirma estado OPEN por falta de evidencia explícita de la transición.
**Conclusión:** hipótesis intercloud **SOSTENIDA**. R1 = disponibilidad degradada, no respuestas completas.

*Lab mocks (referencia):* `aws-rounds-20261116215016` — misma lógica hacia `hotel-mock`; p95 R1 −47% vs R0; no sustituye el live OCI.

## 6. Observabilidad (OTel / Tempo / Prometheus)

- Export OTLP HTTP/protobuf → Collector OCI (TLS + Basic); evidencia `evidence/otel-oci/`.
- Logs Sports con `traceId` / `otelTraceId`; fix W3C: un solo `traceparent` (Undici).
- Tempo (Samuel): correlación Hotel 503 e intercloud (esperas R0/R1).
- Prometheus/Grafana: dashboards/series CB **no** archivados localmente para afirmar OPEN; métricas de app y gate local sí versionadas.

Chaos Gate CI (mocks/fixtures sintéticos, **sin** caos cloud):
https://github.com/JarrisonLopez/sports-tournaments-api/actions/runs/44204457598 — **success** en `ba1e3ea`.

## 7. Patrones de resiliencia

1. **Timeout** Hotel (`HOTEL_TIMEOUT_MS`; 400 ms en R1 latencia).
2. **Fallback** habitación degradada ante timeout/5xx → flujo puede continuar con Cine (`status=partial`).
3. **Circuit breaker** en código R1 (protege llamadas repetidas a Hotel); uso observado solo de forma **indirecta**; no se declara OPEN sin métrica explícita.

## 8. Rollback y recuperación

| Chequeo | Resultado |
|---|---|
| Hotel 503 | `mode-rollback-20261117012351/` — 2/2 Ready; resiliencia ON; caos OFF; flujo success |
| Intercloud live | `05-after-restore-k8s.txt` / `05-after-flujo` — ConfigMap real OCI/GCP; `CHAOS_LAB_ENABLED=false`; success upstream+database |
| Flags estables | `RESILIENCE_ENABLED=true`, `HOTEL_FALLBACK_ENABLED=true` |

## 9. Uso de IA (Cursor)

Orquestación documental, clasificación k6 y consolidación de evidencias. No se inventaron capturas Grafana ni se reinyectó caos en este cierre.

## 10. Conclusiones y limitaciones

- Tres frentes reales cerrados: **503 Hotel (Samuel)**, **integración/verificación Cine (Daniel)**, **latencia intercloud OCI**.
- Resiliencia R1 preserva **disponibilidad degradada**; partial ≠ full.
- Hipótesis 503 e intercloud **SOSTENIDAS** con evidencias en repo.
- Limitaciones: un nodo EC2; TTL OCI exige ventanas separadas; Tempo/Prometheus de CB viven sobre todo en el lado Hotel/observabilidad compartida; Chaos Gate CI ≠ experimentos cloud.
