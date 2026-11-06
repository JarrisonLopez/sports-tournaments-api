# Canary de sports-demo-api

Un solo servicio Cloud Run, `sports-demo-api`, con dos revisiones. Terraform crea la plantilla Stable. GitHub Actions crea la revisión Canary y los porcentajes. No se crea un segundo servicio.

## Cloud SQL MySQL 8.4

La documentación de Cloud SQL dice que el socket Unix del Auth Proxy no está soportado con `caching_sha2_password`. El volumen `/cloudsql` de Cloud Run usa ese socket y no permite fijar Auth Proxy >= 2.19.0. Por eso la API no abre `/cloudsql/<connection name>`.

Sin `DB_HOST`, y con `CLOUD_SQL_CONNECTION_NAME` válido, el proceso usa `@google-cloud/cloud-sql-connector` 1.12.1: TLS a la IP pública ya existente, sin redes autorizadas, con la cuenta de servicio (`cloudsql.client`) y `AuthTypes.PASSWORD`. La contraseña sigue en Secret Manager. No se usa el usuario `root`.

Con `DB_HOST`, la conexión es TCP. El desarrollo, el bootstrap y las pruebas quedan en ese camino y no construyen el conector. Vitest rechaza el cargador real.

Esa ruta no se ejecutó contra la instancia `sports-demo-mysql`. Antes del primer despliegue hace falta un preflight: una revisión sin tráfico, `SELECT 1` y el arranque de esquema, con la misma cuenta y el mismo secreto. Si falla, no se mueve tráfico.

## Bootstrap y despliegue

`synchronize`, `migrationsRun` y `dropSchema` siguen en `false`. El arranque solo lee columnas. Eso no equivale al historial.

| `accion` del plan | Decisión | ADOPT |
|---|---|---|
| `already-applied` | se puede desplegar | no |
| `apply` | pausa: la base vacía exige APPLY | no |
| `adoption-required` | bloquea; hay tablas sin historial canónico | no se ejecuta |
| `incompatible` | bloquea | no |

`entrega3-gcp.yml` ya no construye Sports. Cualquier update de `sports-demo-api` lo rechaza `scripts/validate_entrega3_deploy_plan.py`, porque un cambio de plantilla con tráfico `LATEST` puede llevar el 100% a la revisión nueva. `ignore_changes = [scaling, traffic]` evita reescribir porcentajes; no se comprobó con un plan remoto y no sustituye al validador.

## Tráfico

1. Stable 100 / Canary 0
2. 90 / 10
3. 50 / 50
4. 0 / 100

La comparación usa `GET /api/v2/torneos/1`. Las rutas `/api/v4` solo se llaman por la URL etiquetada. Al llegar al 100% de Canary la revisión Stable permanece.

## Umbrales de demostración

No son SLO de producción.

| Control | Valor |
|---|---|
| Muestras mínimas | 30 |
| Error rate | 5%, o más de 2 puntos sobre Stable |
| p95 | 1500 ms, o más del doble del p95 de Stable |
| Observación | 60 s, configurable hasta 600 s |

`continue` avanza. `pause` no cambia tráfico y no hace rollback: métricas ausentes, consulta fallida o latencia ilegible. Una consulta fallida no cuenta como cero errores. `abort` es el rollback: error rate, p95, smoke 5xx o fault injection. El rollback devuelve 100% a la revisión Stable nombrada, deja Canary en 0 y no borra revisiones ni toca Cloud SQL.

Las métricas previstas son las nativas `run.googleapis.com/request_count` y las latencias, CPU y memoria del recurso `cloud_run_revision`. El código OpenTelemetry no tiene exportador en Cloud Run (`otel_exporter_otlp_endpoint` vacío), así que esas series no están en Cloud Monitoring.

## Imágenes

Stable `v3.0.2` en `sports-api-v3`. Canary `v4.0.0` en `sports-api-v4`. Las dos por digest `@sha256` y SHA de Git. Un Image ID local no es un digest del registry. No se publicaron imágenes ni tags.

## Primera ejecución real

1. Confirmar el plan de bootstrap `already-applied` con el workflow de esquema. No usar ADOPT.
2. Ejecutar el preflight del conector en una revisión sin tráfico.
3. Quitar el paso que bloquea las llamadas a GCP en `entrega3-canary.yml`.
4. Publicar los dos digests. No usar `latest`.
5. `deploy-stable` con `--no-traffic`, smoke en la URL `stable` sobre `/api/v2/torneos/1`, y solo después 100% a esa revisión.
6. `deploy-canary` con `--no-traffic` y etiqueta `canary`. Smoke de `/api/v4` solo en esa URL.
7. Sustituir el fixture de error del paso `promote` por una consulta real. Sin muestras, el job debe seguir en pausa.
8. No correr `entrega3-gcp.yml` para cambiar Sports mientras exista el reparto.
