# Canary de sports-demo-api

Un solo servicio Cloud Run, `sports-demo-api`, con dos revisiones. Terraform crea la plantilla Stable. GitHub Actions crea la revisión Canary y los porcentajes. No se crea un segundo servicio.

## Arquitectura

Stable y Canary son commits distintos. La imagen `sports-api-v3` se construye solo si el checkout no contiene `src/routes/v4/index.ts`. La imagen `sports-api-v4` se construye solo si ese archivo existe. El workflow corre en `main` porque WIF solo autoriza esa rama, pero recibe los dos SHA y los comprueba antes de `docker build`.

La audiencia del token ID es la URL principal del servicio. La petición de smoke va a la URL etiquetada `stable` o `canary`. Las cabeceras `x-api-version` y `x-api-track` identifican la revisión. Un 401 o 403 detiene la validación. `/api/v4` solo se pide en la etiqueta Canary.

## Cloud SQL MySQL 8.4

Sin `DB_HOST`, y con `CLOUD_SQL_CONNECTION_NAME` válido, el proceso usa `@google-cloud/cloud-sql-connector` 1.12.1. La contraseña sigue en Secret Manager. No se usa el usuario `root`.

El arranque lee las columnas de `torneos`, `canchas` y `jugadores` y solo entonces escribe `Esquema de negocio comprobado`. `/health/ready` sigue siendo `SELECT 1`. El preflight exige las dos cosas: ready 200 y esa línea en los logs de la revisión. Si falta la línea, ready no autoriza tráfico.

Ese preflight no se ha ejecutado contra `sports-demo-mysql`. `scripts/canary_gcp.sh` lo hace en el momento del despliegue, después de crear la revisión sin tráfico y antes de mover porcentajes. Si falla, el script termina y no llama a `update-traffic`.

## Bootstrap

`synchronize`, `migrationsRun` y `dropSchema` siguen en `false`.

| `accion` del plan | Decisión de despliegue | Escritura |
|---|---|---|
| `already-applied` | se puede desplegar; el historial ya está registrado | no |
| `apply` | pausa: la base vacía exige el workflow de esquema | solo ese workflow, con `APPLY:sports_db` |
| `adoption-required` | bloquea | ADOPT no se ejecuta |
| `adoption-required:SCHEMA-COMPATIBLE:sports_db` | se puede desplegar sin DDL | no escribe `schema_bootstrap_history` |
| `incompatible` | bloquea | no |

`adoption-required` significa que `classifySnapshot` ya comparó tablas, columnas, índices, engine y claves foráneas con el esquema canónico y no encontró diferencias. No es lo mismo que `already-applied`: no hay fila de historial y no se inventa. La confirmación `SCHEMA-COMPATIBLE:sports_db` solo autoriza el despliegue de solo lectura después de ver esa acción en el plan. `ADOPT:sports_db` sigue bloqueado. Una diferencia de columna, índice o clave foránea cae en `incompatible` y esta confirmación no la salta.

## Métricas

El quality gate lee `timeSeries.list` de Cloud Monitoring. No consulta GCP en las pruebas.

| Métrica | Uso |
|---|---|
| `run.googleapis.com/request_count` | solicitudes y 5xx por `response_code_class` |
| `run.googleapis.com/request_latencies` | p50, p95 y p99 |
| CPU y memoria de la revisión | observabilidad, no criterio de promoción |

Los filtros exigen proyecto `sports-tournaments-multicloud`, región `us-central1`, servicio `sports-demo-api` y el nombre exacto de la revisión. Los contadores son DELTA: se suman puntos que no se solapan, también entre series con las mismas etiquetas. Una serie CUMULATIVE no se suma. `request_latencies` es DISTRIBUTION. Si la serie declara unidad `s`, el percentil se pasa a milisegundos. Si declara `ms`, se conserva. Sin unidad, o con unidades mezcladas, la consulta queda en error. Si el percentil cae en el bucket de overflow, p95 queda ausente.

Una consulta fallida, una serie de otra revisión o una lista vacía no equivalen a cero errores. Cero errores HTTP solo se acepta cuando la consulta fue válida y hubo solicitudes. Cloud Monitoring muestrea cada 60 segundos y puede tardar hasta 120 segundos más en publicar. La ventana mínima es 180 segundos y termina 120 segundos antes de la consulta. Una espera de 60 segundos no se acepta como evidencia.

## Umbrales de demostración

No son SLO de producción.

| Control | Valor |
|---|---|
| Muestras mínimas por revisión | 30, leídas en Monitoring |
| Error rate | 5%, o más de 2 puntos sobre Stable |
| p95 | 1500 ms, o más del doble del p95 de Stable |
| Ventana | 180 s a 600 s |
| Reintentos de consulta | 3, con 20 s entre ellos, solo si el estado es error o todavía no publicado |
| Espera máxima | 600 s |

`continue` exige métricas válidas dentro de los umbrales. La única excepción es el paso 0% → 10%: se admite por smoke y por el preflight del conector, y esa admisión no cuenta como éxito de las métricas.

`pause` no promociona. Cubre datos insuficientes, series todavía no publicadas y una ventana demasiado corta.

`abort` cubre una regresión confirmada, un smoke fallido y la falta de observabilidad cuando Canary ya tiene tráfico y la espera llegó a 600 segundos. En ese último caso el motivo queda escrito como falta de observabilidad, no como regresión comprobada, y el tráfico vuelve a Stable.

## Tráfico y carga

1. Stable 100 / Canary 0
2. 90 / 10
3. 50 / 50
4. 0 / 100

No se saltan etapas. El tráfico se describe antes de cambiarlo y se vuelve a describir después. La comparación usa `GET /api/v2/torneos`, que existe en las dos revisiones y no depende de un id.

La carga de demostración va a la URL principal. Al 10% hacen falta 450 solicitudes para que la porción menor pueda acercarse a 30 muestras, con tope de 800 solicitudes, concurrencia 4, duración 240 segundos y un reintento. Treinta solicitudes totales no son 30 muestras de Canary. Las muestras se leen después, por revisión, en Monitoring. Esta carga no se ejecutó.

El rollback deja Stable al 100% y Canary al 0% en las revisiones nombradas. No borra revisiones. Si `update-traffic` falla, el resultado no se da por restaurado.

## Terraform

`entrega3-gcp.yml` no construye Sports. El validador rechaza cualquier update de `sports-demo-api`: la plantilla guardada usa tráfico `LATEST` y un apply de plantilla puede mover el 100% a la revisión nueva. `ignore_changes = [scaling, traffic]` se validó con el provider 6.50.0 sin plan remoto. Omite el tráfico de la máscara de update y no impide que la API mueva un objetivo `LATEST`.

No se hizo `terraform apply` ni se consultó el estado remoto. Si más adelante hay que cambiar la plantilla Stable con Terraform, el procedimiento queda pendiente y no se ejecuta ahora:

1. Describir el tráfico real y anotar los nombres de revisión y los porcentajes.
2. Pasar el tráfico a revisiones concretas, no a `LATEST`, con el workflow Canary.
3. Revisar un plan que no cambie `sports-demo-api` mientras esos porcentajes existan.
4. No aplicar el módulo raíz para “actualizar la imagen” durante un canary.

## Versiones

Stable es API `3.0.2`, imagen `sports-api-v3`, commit `55242238efb7d0f8ce44f3d5deba262fdc1aaff1`, sin `src/routes/v4`. Canary es API `4.0.0`, imagen `sports-api-v4`, y se publica desde `git rev-parse feature/canary-seguimiento-3` en el momento del push. Ese commit tiene que descender de `8685993c20278df2902609a7ff20116a8c349b33` y contener `src/routes/v4/index.ts`. El tag de la imagen es el SHA de Git, no `latest` y no un tag SemVer. En el repositorio local existen los tags `v3.0.0` y `v3.0.1`. No existen `v3.0.2` ni `v4.0.0`, y no se crean. No se mueven los tags ya existentes.

`production.yml` se dispara con un push a `main`. Instala, compila y ejecuta las pruebas de Node. Usa el environment `production` de GitHub y no autentica contra GCP, no publica imágenes y no cambia Cloud Run. Un merge a `main` puede pedir aprobación de ese environment y fallar si las pruebas del árbol de `main` fallan. No despliega la API.

## Publicar las dos ramas sin mezclarlas

Estos comandos no se ejecutaron.

```bash
git push origin feature/canary-stable-v3
git push origin feature/canary-seguimiento-3
git fetch origin main
git switch -c release/canary-workflows origin/main
git checkout "$(git rev-parse feature/canary-seguimiento-3)" -- \
  .github/workflows/entrega3-canary.yml \
  .github/workflows/entrega3-gcp.yml \
  .github/workflows/entrega3-schema-bootstrap.yml \
  scripts/canary_gcp.sh \
  scripts/canary_rollout.py \
  scripts/canary_smoke.py \
  scripts/cloud_monitoring.py \
  scripts/run_json_argv.py \
  scripts/validate_entrega3_deploy_plan.py \
  scripts/tests \
  docs/seguimiento-3-canary.md \
  terraform
```

Antes del commit de esa rama hay que comprobar que `src/` no cambió y que Stable no se construye desde el árbol de `main`. El workflow, ya en `main`, hace `git checkout --detach` de cada SHA y rechaza Stable si aparece `src/routes/v4/index.ts`. No hacer merge de `feature/canary-seguimiento-3` sobre `main` ni de Stable sobre Canary. WIF solo acepta `refs/heads/main` en `JarrisonLopez/sports-tournaments-api`. El dispatch manual corre desde `main` y los SHA de las imágenes tienen que existir ya en el remoto.

## Primer despliegue

Parar si falta un permiso, el plan no es el esperado, el preflight no muestra las tablas o Monitoring no publica muestras. El conector no está probado contra `sports-demo-mysql`.

1. Plan de esquema, sin ADOPT. El dispatch lleva `source_sha` del commit de `feature/canary-seguimiento-3`: el job hace checkout de ese commit antes de `npm ci` y no usa el árbol de `main` para el CLI. Si la acción es `apply`, correr solo el workflow de esquema con `APPLY:sports_db`. Si es `adoption-required` y el plan no lista diferencias, el despliegue usa `adoption-required:SCHEMA-COMPATIBLE:sports_db`. Si es `incompatible`, no desplegar.
2. Dispatch `publish`, confirmación `PUBLISH`, `source_shas` con el SHA Stable, una coma y el SHA Canary, `timing` `180,0`. Guardar los dos digests que imprime el push. Un Image ID local no sirve.
3. Dispatch `deploy-stable`, confirmación `DEPLOY-STABLE`, digest v3 y la acción de bootstrap. La revisión nace sin tráfico. El script exige el digest, ready, `Esquema de negocio comprobado` y `/health/ready` 200. Solo después asigna 100% a esa revisión y vuelve a describir el servicio.
4. Anotar el nombre de la revisión Stable. No usar `latest`.
5. Dispatch `deploy-canary`, confirmación `DEPLOY-CANARY`, los dos digests. Smoke de `GET /api/v2/torneos` y `GET /api/v4/torneos/estadisticas` contra la URL etiquetada, con audiencia de la URL principal. Canary queda en 0%.
6. Enviar la carga a la URL principal, no a un torneo con id 1. Al 10% el plan local pide 450 solicitudes, con tope 800, concurrencia 4 y 240 segundos. Las muestras se leen después por revisión.
7. Dispatch `promote`, confirmación `PROMOTE`, `split` `90/10`, luego `50/50` y `0/100`. `timing` mínimo `180,0`. Entre etapas el job consulta `request_count` y `request_latencies`. Si la decisión no es `continue`, no avanza. Si es `abort`, devuelve 100% a la revisión Stable y comprueba el resultado.
8. `rollback` con confirmación `ROLLBACK` repite esa restauración si hace falta. No borra revisiones.
9. No correr `entrega3-gcp.yml` mientras el reparto exista. Su validador rechaza un update de `sports-demo-api`.

La regresión en GCP no queda armada: el comando de despliegue rechaza `FAULT_INJECTION_ENABLED`. El rollback ante 5xx está probado con métricas simuladas. Para provocarlo en Cloud Run haría falta un cambio aparte, solo en la revisión Canary, y no forma parte de este workflow.

## Permisos y secretos

- WIF `github-provider` y la cuenta `sports-demo-deploy` para el workflow.
- La cuenta de runtime `sports-demo-api` con `cloudsql.client` y acceso al secreto `sports-demo-db-password`.
- Artifact Registry `sports-demo-images` para `sports-api-v3` y `sports-api-v4`.
- Cloud Monitoring `timeSeries.list` y lectura de logs de Cloud Run.
- `gcloud run services update-traffic` sobre `sports-demo-api` en `us-central1`.
- El secreto de MySQL no se imprime. El token ID no se imprime. Su audiencia es la URL principal.

## Evidencias para la sustentación

Todavía no hay capturas de un despliegue. Hay que guardar, cuando se ejecute:

- Los dos SHA y los dos digests de Artifact Registry.
- El plan de bootstrap con su `accion`, sin presentar la confirmación de esquema compatible como historial aplicado.
- El nombre de cada revisión, el digest que describe y el tráfico antes y después de cada porcentaje.
- El log `Esquema de negocio comprobado` y el 200 de `/health/ready` en la revisión sin tráfico.
- Las cabeceras `x-api-version` y `x-api-track` del smoke, sin el token.
- El JSON de `timeSeries.list` de cada revisión, con `response_code_class`, unidad de latencia y la decisión del gate.
- Si hubo rollback, la descripción posterior con Stable al 100% y Canary existente al 0%.

## Repetir la demostración

```bash
python scripts/tests/test_cloud_monitoring.py
python scripts/tests/test_canary_rollout.py
python scripts/tests/test_canary_smoke.py
python scripts/tests/test_canary_scenarios.py
python scripts/tests/test_validate_entrega3_deploy_plan.py
```

Esas pruebas no llaman a GCP. La promoción simulada recorre 100/0, 90/10, 50/50 y 0/100. La regresión simulada devuelve el tráfico a Stable. El primer recorrido real sigue siendo el dispatch descrito arriba.
