# Informe Seguimiento #4 — Ingeniería del Caos (Sports / AWS)

**Autor:** Jarrison López  
**Alcance:** Sports Tournaments API como coordinador multicloud  
**Extensión:** ≤ 6 páginas  
**Evidencia AWS:** `docs/seguimiento-4/evidence/aws-rounds/aws-rounds-20261116215016/`

## 1. Objetivo y arquitectura

Sports coordina de forma **síncrona y secuencial** Hotel (OCI / Samuel) y Cine (GCP / Daniel) vía `GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId`, propagando `x-trace-id` y W3C `traceparent`.

**Plataforma:** Kubernetes ligero **k3s sobre EC2** en `us-east-2` (perfil `sports-chaos`), namespace `sports-lab`, **2 réplicas** Ready, MySQL de laboratorio, NodePort `:30080`. Manifiestos en `k8s/aws/`.

**Estado estable verificado:** Sports http://3.21.120.51:30080; Hotel http://149.130.165.30; Cine http://35.239.107.54. Tras experimentos, flujo real vuelve a `status=success` sin mocks ni fallback.

**Limitación:** un solo nodo EC2 no aporta HA ante pérdida de la instancia.

## 2. Experimento

| Campo | Valor |
|---|---|
| Fallo | Latencia 800 ms Sports → Hotel (interruptor lab) |
| Herramienta | Chaos Toolkit YAML + helpers multi-pod + k6 |
| Interruptor | `POST/DELETE /chaos/hotel-latency` (`CHAOS_LAB_ENABLED`) |
| Destino del fallo | **solo** `hotel-mock` en `sports-lab` (no OCI/GCP) |
| Métrica | % full / partial / failed, disponibilidad, p95 |
| Radio | Cliente Hotel en proceso Sports |
| Aborto | ready≠200 o armado fallido |
| Reversión | disarm multi-pod + ConfigMap multicloud real |

## 3. Hipótesis (a priori)

Con timeout + circuit breaker + fallback ante latencia Hotel (misma carga e inyección), la **disponibilidad** (full+partial) permanece ≥90%, el **p95** de respuestas disponibles baja ≥30% vs R0, y se reporta aparte full vs partial (**parcial ≠ éxito completo**). Umbrales no se relajan a posteriori.

## 4. Método Baseline / R0 / R1 (AWS)

Perfil k6 fijo: 15s@2 VU → 45s@4 VU → 15s@0; endpoint `/api/v2/flujo/1/1/1`.

| Ronda | Config | Fallo | Resiliencia |
|---|---|---|---|
| Baseline | mocks | no | off |
| R0 | mocks | 800 ms | off |
| R1 | mocks | 800 ms | timeout 400 + CB + fallback |

Orquestación: `scripts/chaos/run_aws_rounds.ps1`. Hallazgo operativo: un `env` hardcodeado en el Deployment **pisaba** el ConfigMap; se eliminó para que el CM controle URLs y flags.

## 5. Resultados AWS (medidos)

| | Baseline | R0 | R1 |
|---|---:|---:|---:|
| Iteraciones | 394 | 132 | 330 |
| Éxito completo | 100% | 100% | **0%** |
| Parcial | 0% | 0% | **100%** |
| Fallo | 0% | 0% | 0% |
| Disponibilidad | 100% | 100% | **100%** |
| p95 (ms) | 111.6 | 980.4 | **516.4 (−47%)** |

**Conclusión:** hipótesis **SOSTENIDA**. Compromiso: R1 prioriza disponibilidad degradada (fallback) frente a éxito completo; no se confunde parcial con full.

**Evidencia timeout/CB:** respuesta R1 con `origenResiliencia=fallback`; logs ~405 ms tras timeout y luego ~3–4 ms con CB abierto.

## 6. Observabilidad

Logs correlacionan `traceId` y `otelTraceId`. OTLP hacia Collector OCI (`https://otel-lab.local:31443` vía hostAlias; SAN del cert). Protocol `http/protobuf`, Basic + CA en Secrets. Detalle: `OTLP_OCI.md` + `evidence/otel-oci/`.

## 7. Dos patrones de resiliencia

1. **Timeout** en cliente Hotel (`HOTEL_TIMEOUT_MS`) — corta espera bajo latencia inyectada.  
2. **Circuit breaker + fallback** — tras fallos/timeouts, abre el circuito y sirve habitación degradada válida (`status=partial`).

## 8. Uso de IA (Cursor)

Apoyo en orquestación AWS, ConfigMaps de experimento, clasificación k6 full/partial/failed y redacción de evidencias. Descartado: inyectar fallos en OCI/GCP; afirmar OTLP compartido sin Collector.

## 9. Hallazgos, limitaciones y backlog

- Fallo controlado en cliente saliente Sports→Hotel; radio acotado a Sports (no altera OCI/GCP).  
- Rondas AWS con **mocks** ya medidas (`aws-rounds-20261116215016`).  
- Rondas **intercloud** (Hotel OCI real) preparadas en `EXPERIMENTO_INTERCLOUD.md`; ejecución live pendiente de ventana con Samuel (`-AuthorizeIntercloud`).  
- Estado de caos es **por pod** → armar ambas réplicas.  
- Sin HA multi-nodo.  
- Backlog: Samuel confirma spans en Tempo/Grafana (`otelTraceId` en `evidence/otel-oci/`); autorización Samuel → intercloud; demo.
