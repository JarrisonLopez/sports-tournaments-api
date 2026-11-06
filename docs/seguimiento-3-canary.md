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

| `accion` del plan | Decisión | ADOPT |
|---|---|---|
| `already-applied` | se puede desplegar | no |
| `apply` | pausa: la base vacía exige APPLY | no |
| `adoption-required` | bloquea; hay tablas sin historial canónico | no se ejecuta |
| `incompatible` | bloquea | no |

Una base creada antes por `synchronize` puede hacer arrancar el proceso y, a la vez, clasificarse como `adoption-required`. ADOPT sigue bloqueado. Ese estado no se trata como desplegable.

## Métricas

El quality gate lee `timeSeries.list` de Cloud Monitoring. No consulta GCP en las pruebas.

| Métrica | Uso |
|---|---|
| `run.googleapis.com/request_count` | solicitudes y 5xx por `response_code_class` |
| `run.googleapis.com/request_latencies` | p50, p95 y p99 |
| CPU y memoria de la revisión | observabilidad, no criterio de promoción |

Los filtros exigen proyecto, región `us-central1`, servicio `sports-demo-api` y el nombre exacto de la revisión. Los contadores son DELTA: se suman puntos que no se solapan. Una serie CUMULATIVE no se suma. Las latencias son DISTRIBUTION en segundos y se convierten a milisegundos. Si el percentil cae en el bucket de overflow, p95 queda ausente.

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

## Primera ejecución autorizada

WIF solo autoriza `refs/heads/main`. No se mezclan los árboles: Stable es el commit que no tiene rutas v4 y Canary es el commit que sí las tiene. Los dos SHA tienen que existir en el remoto antes de lanzar el workflow. No se reutiliza un tag SemVer. El digest se lee de Artifact Registry después del push.

Orden:

1. Integrar en `main` el commit Stable y el commit Canary como referencias alcanzables, sin construir Stable desde el árbol Canary. No está hecho en esta entrega.
2. Confirmar el plan de bootstrap. `already-applied` permite desplegar. `apply` exige el workflow de esquema antes. `adoption-required` bloquea, aunque el proceso pueda arrancar. ADOPT no se ejecuta.
3. En `main`, despachar `entrega3-canary.yml` con operación `publish`, confirmación `PUBLISH` y `source_shas` con los dos SHA separados por coma. `timing` queda en `180,0`. Guardar los digests impresos.
4. `deploy-stable` con `DEPLOY-STABLE`, el digest y `already-applied`. El script crea la revisión sin tráfico, comprueba digest, ready, logs y `/health/ready`, y solo después asigna 100% a esa revisión.
5. `deploy-canary` con `DEPLOY-CANARY`. Smoke de `/api/v2/torneos` y de `/api/v4/torneos/estadisticas` en la URL etiquetada. No asigna tráfico.
6. `promote` con `PROMOTE`, de 0 a 10, luego de 10 a 50 y de 50 a 100. Entre las etapas con tráfico, la ventana es de al menos 180 segundos. Si el gate aborta, el mismo job devuelve 100% a Stable y verifica el resultado.
7. `rollback` con `ROLLBACK` si hace falta repetir la restauración.
8. No correr `entrega3-gcp.yml` para cambiar Sports mientras el reparto exista.

El conector sigue sin una prueba real. El primer `deploy-stable` es esa prueba. Si los logs no contienen `Esquema de negocio comprobado`, no hay promoción.

## Evidencias para la sustentación

- SHA de Stable y de Canary, y los dos digests de Artifact Registry.
- Nombre exacto de cada revisión, leído del despliegue y verificado con `gcloud run revisions describe`.
- Respuesta de `timeSeries.list` filtrada por revisión, con `response_code_class` y el histograma de latencia.
- Decisión `continue`, `pause` o `abort`, con el motivo.
- Tráfico descrito antes y después de cada porcentaje.
- Log `Esquema de negocio comprobado` y ready 200 de la revisión sin tráfico.
- Si hubo rollback, el 100% verificado en la revisión Stable y la revisión Canary conservada en 0%.
