# Seguimiento #3 — Baseline Canary Deployment

Documento de diseño. No describe un despliegue canary ya implementado ni valida el estado live de GCP.

## 1. Objetivo y versiones

Implementar Canary Deployment sobre la infraestructura de Entrega 3 (Cloud Run, Terraform, Cloud SQL, Artifact Registry, GitHub Actions), con observabilidad en Cloud Monitoring.

| Rol | Superficie HTTP | Release SemVer de referencia |
|---|---|---|
| **Stable** | Sports API v3 (`/api/v3`, más V1/V2 conservadas en el binario) | Línea `v3.0.x` (tags existentes: `v3.0.0`, `v3.0.1`) |
| **Canary** | Sports API v4 (nueva superficie `/api/v4` + compatibilidad con rutas previas) | Objetivo `v4.0.0` (pendiente de tag/release) |

El campo `version` de `package.json` sigue en `1.0.0` y **no** equivale a la versión de ruta ni al tag SemVer. Ver sección 3.

## 2. Inventario resumido (repositorio)

| Recurso / capacidad | Referencia en repo |
|---|---|
| Sports API (Fastify, Node 22) | `src/app.ts`, `Dockerfile`, `package.json` |
| Rutas V1 (sin prefijo `/api/v1`) | `src/routes/torneo.routes.ts`, `cancha.routes.ts`, `jugador.routes.ts` |
| Rutas V2 | `src/routes/v2/` |
| Rutas V3 | `src/routes/v3/`, `src/controllers/v3-artifact.controller.ts` |
| Health | `src/routes/health.routes.ts` → `/health/live`, `/health/ready` |
| MySQL / TypeORM (`synchronize: true`) | `src/config/database.ts`, entidades en `src/entities/` |
| Object Storage (servicio aparte) | `object-storage/` |
| Stack Terraform principal | `terraform/main.tf`, `terraform/modules/cloud_run_service/` |
| Bootstrap tfstate / identidad persistente | `terraform/bootstrap/`, `terraform/persistent/` |
| Deploy CI (build SHA + Terraform apply) | `.github/workflows/entrega3-gcp.yml` |
| Provision CI | `.github/workflows/entrega3-provision.yml` |
| Validador de plan Deploy | `scripts/validate_entrega3_deploy_plan.py` |
| Tests / CI sin deploy GCP | `tests/`, `.github/workflows/testing.yml`, `production.yml` |
| Métricas RED (OTel; export solo si hay endpoint) | `src/observability/metrics.ts` |

Nombres de servicio usados en CI/documentación de Entrega 3: `sports-demo-api`, `sports-demo-storage`. El estado **operativo en la nube** de esos recursos no se afirma aquí; requiere verificación GCP aparte.

## 3. Cuatro conceptos distintos

| Concepto | Qué identifica | Ejemplo |
|---|---|---|
| **Versión de ruta HTTP** | Prefijo de API en el código | `/api/v3`, futuro `/api/v4` |
| **SemVer (release)** | Tag/release del repositorio e imagen | `v3.0.1`, `v4.0.0` |
| **Revisión Cloud Run** | Instancias inmutables de un servicio | `sports-demo-api-<revision-id>` |
| **Track** | Rol en el canary (`stable` / `canary`) | Variable de entorno prevista, p. ej. `API_TRACK` |

Una revisión canary puede servir `/api/v3` y `/api/v4`. Un tag SemVer no es lo mismo que el prefijo HTTP.

## 4. Arquitectura propuesta

**Opción elegida para diseño:** dos revisiones del **mismo** servicio Cloud Run `sports-demo-api`, con split de tráfico nativo por porcentaje.

```text
Cliente (IAM run.invoker)
        │
        ▼
sports-demo-api  (una URL)
   ├─ revisión stable  → imagen v3.x, API_TRACK=stable
   └─ revisión canary  → imagen v4.x, API_TRACK=canary
        │
        ├─ Cloud SQL MySQL (compartido)
        └─ Object Storage (sin cambio obligatorio de canary)
```

**Descartada por ahora como camino principal:** dos servicios Cloud Run + balanceador/router (más piezas de IAM, URL y Terraform). Puede reevaluarse si el split por revisión no cubre la rúbrica.

Object Storage (`sports-demo-storage`) permanece compartido salvo que un requisito futuro exija lo contrario.

## 5. Plan de tráfico y bake times

Etapas propuestas (porcentajes de tráfico **público** hacia canary):

| Etapa | Canary | Stable | Bake time |
|---|---|---|---|
| 0 | 0 % (acceso controlado a la revisión canary para pruebas) | 100 % | *Pendiente de validar* |
| 1 | ~10 % | ~90 % | *Pendiente de validar* |
| 2 | ~50 % | ~50 % | *Pendiente de validar* |
| 3 | 100 % | 0 % | *Pendiente de validar* |

Los bake times exactos (p. ej. 10–30 min académicos vs. carga sintética) se definirán tras la primera corrida con métricas suficientes. Entre etapas: observar errores, latencias y métrica de negocio antes de promover o abortar.

## 6. Terraform vs GitHub Actions (riesgo de conflicto)

**Estado actual (código):**

- Terraform declara la imagen del servicio en `google_cloud_run_v2_service` (`terraform/modules/cloud_run_service/main.tf`). No hay bloque de split porcentual entre revisiones.
- `entrega3-gcp.yml` construye `sports-api-v3:${GITHUB_SHA}`, escribe `terraform.tfvars` en el runner y hace apply → la revisión nueva tiende a quedar con **todo** el tráfico.
- El validador `scripts/validate_entrega3_deploy_plan.py` solo permite create/update acotados de los dos Cloud Run (+ IAM invoker de storage).

**Reparto propuesto (pendiente de implementar):**

| Responsable | Responsabilidad canary |
|---|---|
| Terraform | Imagen(es), env (`API_VERSION`, `API_TRACK`), CPU/memoria, SQL, IAM base; **no** resetear porcentajes de tráfico en cada apply |
| GitHub Actions | Build/push de imágenes inmutables; desplegar revisión canary; **promoción** `0→10→50→100`; **rollback** `100 % stable / 0 % canary`; bake waits; quality gate |

**Riesgo de conflicto:** si el tráfico se cambia con `gcloud run services update-traffic` (u otra herramienta) y Terraform vuelve a aplicar el servicio sin `lifecycle.ignore_changes` (u omisión explícita de `traffic`), el apply puede **revertir** el split al estado declarado (p. ej. 100 % latest). Un Deploy “normal” de Entrega 3 durante una demo canary también puede anular el experimento.

Mitigación a diseñar: `ignore_changes` sobre tráfico (o tráfico solo fuera de Terraform), workflow dedicado de promote/rollback, y no reutilizar a ciegas el Deploy actual mientras haya canary activo.

## 7. Compatibilidad v3 / v4 y `synchronize: true`

- v3 y v4 compartirán la **misma** base Cloud SQL y el mismo contrato de lectura de torneos/canchas/jugadores mientras el canary esté activo.
- Estrategia de datos: **Expand/Contract** (solo cambios aditivos y retrocompatibles; columnas nuevas nullable; sin drops/renames en el mismo release).
- **Riesgo:** `synchronize: true` en `src/config/database.ts` hace que el arranque de una revisión pueda alterar el esquema. Una columna incompatible rompería stable aunque el tráfico vuelva a 100 % stable (el rollback de tráfico **no** deshace DDL).

Hasta que haya migraciones explícitas y disciplina de esquema, v4 debe preferir cambios **sin** migración, o solo Expand revisado.

## 8. Rutas solo-v4 bajo split aleatorio (404)

Con split por porcentaje, un cliente que pegue siempre a la URL del servicio puede caer en stable o canary al azar.

Si `/api/v4/...` existe **solo** en la revisión canary, las peticiones v4 que lleguen a stable responderán **404**. Eso contamina métricas de error y confunde la demo.

**Alternativas (sin decisión final):**

1. **Header/ruta de prueba en etapa 0** hacia la URL de revisión canary (tráfico público 0 %), y no medir 404 de v4 en stable.
2. **Ambos binarios exponen `/api/v4`**, pero stable responde de forma controlada (p. ej. 501/404 documentado o stub); canary implementa la lógica real — implica acoplar despliegues.
3. **Clientes de prueba versionados:** solo el harness de carga/canary llama a `/api/v4`; el tráfico “de negocio” de la demo usa rutas comunes (`/api/v3` o health) para comparar tracks.
4. **Dos servicios + enrutamiento por path** (opción B): path `/api/v4` → canary; resto → stable — más infra, elimina el 404 aleatorio por path.

La decisión se tomará en un commit posterior de diseño/implementación.

## 9. Observabilidad, quality gate y rollback

**Medir por track/revisión (objetivo de rúbrica):**

- Tráfico / rate de peticiones
- Errores HTTP 4xx y 5xx
- Latencias p50 / p95 / p99
- CPU y memoria
- Una métrica de negocio (candidato: requests a `GET /api/v4/torneos/:id/resumen` o equivalente)

**Fuentes previstas:**

- Cloud Monitoring (métricas nativas de Cloud Run por revisión) — a verificar en proyecto
- Instrumentación app (`src/observability/metrics.ts`): hoy sin labels `track`/`version`; OTLP vacío en el tfvars que escribe CI de Entrega 3

**Quality gate (a definir con umbrales numéricos):**

- **Continuar:** errores/latencia canary dentro de SLO vs stable
- **Pausar:** degradación leve o muestra insuficiente
- **Abortar:** breach de SLO → rollback inmediato

**Rollback:** devolver **100 %** del tráfico a la revisión stable y **0 %** a canary, sin destroy de infra ni de Cloud SQL. Automatizar vía GitHub Actions (cuenta de deploy existente / permisos a revisar).

**Dashboard:** comparativo stable vs canary en Cloud Monitoring (aún no existe en el repo).

## 10. Riesgos, decisiones pendientes y verificaciones GCP

### Riesgos

- Apply Terraform o Deploy Entrega 3 resetea tráfico/imagen durante canary
- `terraform.tfvars` local desactualizado (gitignored) aplicado a mano contra estado remoto
- `synchronize: true` y cambios de esquema
- Fault injection mal aislada (debe activarse solo con `API_TRACK=canary`)
- API privada (`allow_unauthenticated = false` en CI): demos necesitan identidad con `run.invoker`
- 404 de rutas solo-v4 bajo split (sección 8)
- Validador de plan Deploy rechaza recursos no allowlisteados

### Decisiones pendientes

- Bake times concretos por etapa
- Umbrales SLO exactos (error rate, p95, métrica de negocio)
- Alternativa anti-404 para `/api/v4` (sección 8)
- ¿Tráfico gestionado solo por Actions, solo por Terraform, o híbrido con `ignore_changes`?
- ¿Object Storage necesita revisión canary propia? (por defecto: no)
- Contenido exacto del endpoint observable v4 (candidato documentado en auditoría: resumen de torneo)
- Alineación `package.json` / tags SemVer / tags de imagen (SHA vs `v4.0.0` + digest)

### Verificaciones necesarias en GCP (no hechas en este documento)

- Servicios Cloud Run presentes y Ready
- Revisión(es) actual(es) e imagen desplegada (tag/digest)
- Split de tráfico actual (esperado: 100 % una revisión)
- Métricas disponibles por `revision_name` en Cloud Monitoring
- Permisos de la SA de deploy para `update-traffic` y lectura de métricas
- Identidad de prueba con `roles/run.invoker` sobre `sports-demo-api`
- Salud de Cloud SQL y secretos (sin exponer valores)

---

*Siguiente paso previsto (fuera de este archivo): commits pequeños de código/CI según el plan incremental; este baseline no modifica infraestructura.*
