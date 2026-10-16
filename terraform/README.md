# Entrega 3 — Infraestructura con Terraform

Esta carpeta declara la infraestructura de la Entrega 3 para el proyecto `sports-tournaments-multicloud`, en `us-central1`. La API individual es `POST /api/v3/torneos/:id/artifact`: Sports lee el torneo en MySQL y Object Storage lo guarda en Cloud Storage. V1 y V2 siguen en el código. `k8s/` sigue siendo la Entrega 2.

**Estado:** stack principal **reaplicado y operativo** tras un Destroy real y reconstrucción (Provision + Deploy). Estado remoto: bucket `sports-tournaments-multicloud-tfstate`, prefijo `entrega3/main`. El Deploy post-rebuild verificado fue sobre el commit `7b79baf` (ambos Cloud Run `Ready=True`, servicios privados).

Roots hermanos: [`bootstrap/`](bootstrap/README.md) (bucket de estado), [`persistent/`](persistent/README.md) (SA `sports-demo-provision` + WIF + Owner temporal).

No ejecutes `terraform init`, `plan`, `apply` ni `destroy` sin autorización explícita. Redespliegue habitual: GitHub Actions Deploy; reconstrucción tras Destroy: Provision y luego Deploy.

## Arquitectura de los módulos

```text
terraform/
├── versions.tf
├── providers.tf
├── variables.tf
├── outputs.tf
├── main.tf
├── terraform.tfvars.example
├── backend.hcl.example
├── bootstrap/          # estado LOCAL: bucket tfstate
├── persistent/         # GCS entrega3/persistent: SA provision
└── modules/
    ├── project_services/
    ├── artifact_registry/
    ├── cloud_storage/
    ├── secret_manager/
    ├── cloud_sql/
    ├── iam/
    └── cloud_run_service/
```

| Módulo | Qué declara |
|---|---|
| `project_services` | APIs de Cloud Run, Cloud SQL Admin, Artifact Registry, Secret Manager, IAM, IAM Credentials, STS y Service Usage. `disable_on_destroy` queda en false. **No** declara Cloud Resource Manager API ni Cloud Storage API (esta última la habilita `bootstrap/`). |
| `artifact_registry` | Un repositorio Docker regional (`sports-demo-images` con el prefijo de ejemplo), sin políticas de limpieza. |
| `cloud_storage` | Bucket privado de artifacts, acceso uniforme y acceso público bloqueado. |
| `secret_manager` | Solo el contenedor del secreto de la contraseña. No crea una versión. |
| `cloud_sql` | Instancia MySQL zonal Enterprise, `edition = "ENTERPRISE"`, disco PD_SSD fijo y la base. No crea el usuario. |
| `iam` | Cuentas de ejecución de Sports API y Object Storage, cuenta de CI `sports-demo-deploy`, permisos acotados, binding WIF hacia `main`, y rol personalizado con `run.services.getIamPolicy` / `setIamPolicy` para el invoker de Object Storage. No crea el pool ni el provider OIDC. No crea llaves JSON. |
| `cloud_run_service` | Un `google_cloud_run_v2_service` reutilizable. `main.tf` lo instancia dos veces cuando `deploy_applications` es true. |

Con el prefijo `sports-demo`, los nombres quedan así:

| Recurso | Nombre |
|---|---|
| Repositorio | `sports-demo-images` |
| Instancia MySQL | `sports-demo-mysql` |
| Secreto | `sports-demo-db-password` |
| Cuenta y servicio de Sports | `sports-demo-api` |
| Cuenta y servicio de Object Storage | `sports-demo-storage` |
| Cuenta de CI | `sports-demo-deploy` |
| Bucket de artifacts | El valor de `artifacts_bucket_name` (en CI: `sports-tournaments-multicloud-demo-artifacts`) |
| Bucket de estado | `sports-tournaments-multicloud-tfstate` (creado por `bootstrap/`, no por este root) |

Cloud Run escucha en el puerto 8080 y el módulo fija `PORT` con ese mismo valor. Sports recibe el socket de Cloud SQL en `/cloudsql/<connection name>` cuando existe `CLOUD_SQL_CONNECTION_NAME`. La contraseña entra por `DB_PASSWORD` como referencia a Secret Manager. Object Storage recibe `GCS_BUCKET_NAME` y no monta Cloud SQL.

Sports depende de la URL de Object Storage. Object Storage no llama a Sports. Esa dependencia se resuelve en un solo apply.

`deploy_applications` tiene por defecto el valor `false` en las variables. El workflow de CI lo pone en `true` y publica las imágenes antes del plan. Con `true`, los dos servicios Cloud Run entran en el grafo.

### Escalado y `ignore_changes`

En `modules/cloud_run_service`, el mínimo y el máximo intencionales viven en `template.scaling` (`min_instance_count` / `max_instance_count`) y sí se planifican.

El provider `hashicorp/google` 6.50 rellena además el bloque `scaling` de **nivel servicio** (`min_instance_count=0`, `manual_instance_count=0`). Sin corrección, cada plan proponía un cambio permanente `0 → null` sin alterar el runtime. El módulo declara `lifecycle { ignore_changes = [scaling] }` solo para ese bloque de servicio. **No** ignora `template.scaling`.

## Variables y configuración local

- Copia `backend.hcl.example` → `backend.hcl` (bucket + prefijo `entrega3/main`).
- Copia `terraform.tfvars.example` → `terraform.tfvars` y alinea valores no secretos con los que escribe CI (proyecto, prefijo `sports-demo`, MySQL, buckets).
- **Nunca** pongas la contraseña MySQL en tfvars ni en el estado. Usa el GitHub Secret `SPORTS_DB_PASSWORD` vía el workflow Provision.
- `terraform.tfvars`, `backend.hcl` y planes están en `.gitignore`.

## GitHub Actions

| Workflow | Cuándo |
|---|---|
| [Entrega 3 GCP Provision](../.github/workflows/entrega3-provision.yml) | Tras Destroy: base (`deploy_applications=false`) + secreto/usuario MySQL |
| [Entrega 3 GCP Deploy](../.github/workflows/entrega3-gcp.yml) | Build/push imágenes + Cloud Run (`deploy_applications=true`) |

### Provision (resumen)

1. Actions → **Entrega 3 GCP Provision** → `main` → `PROVISION`.
2. WIF → `sports-demo-provision@…` (debe existir: root `persistent/`).
3. Apply del stack principal sin Cloud Run; luego `scripts/entrega3_provision_db_credentials.py` con `SPORTS_DB_PASSWORD`.

### Deploy

1. Actions → **Entrega 3 GCP Deploy** → `main` → `DEPLOY`.
2. WIF → `sports-demo-deploy@…`.
3. Build/push → `terraform plan` → validador → apply → `Ready=True`.

### Validador del plan (Deploy)

Script: `scripts/validate_entrega3_deploy_plan.py`.

Admite:

- `no-op` de cualquier recurso del plan;
- `update` de los dos `google_cloud_run_v2_service`;
- `create` de esos dos servicios y de `…service_invoker[0]` en Object Storage (primer Deploy tras Provision).

Rechaza `delete`, `replace` y cualquier otro create/update.

### Resultado post-rebuild (ejecución real)

| Dato | Valor |
|---|---|
| Commit Deploy | `7b79baf` |
| Provision | Success (#3, tras import de Cloud SQL) |
| Cloud Run | Ambos `Ready=True` |
| Acceso | Privado |

## Workload Identity Federation

El pool `github-actions-pool` y el provider OIDC de GitHub **ya existen** fuera de este root. Terraform no los crea ni los modifica.

El módulo `iam` crea la cuenta `sports-demo-deploy` y concede `roles/iam.workloadIdentityUser` al principal:

```text
principal://iam.googleapis.com/projects/171179411205/locations/global/workloadIdentityPools/github-actions-pool/subject/<sub>
```

El `<sub>` debe coincidir con el claim real de GitHub Actions. GitHub emite identificadores numéricos:

```text
repo:JarrisonLopez@140736138/sports-tournaments-api@1349259895:ref:refs/heads/main
```

Las variables `github_owner_id` y `github_repository_id` alimentan ese subject en `main.tf`. Un subject solo con nombres de owner/repo (sin IDs) provoca `403 iam.serviceAccounts.getAccessToken`.

La cuenta deploy tiene permisos acotados (Artifact Registry writer, `roles/run.developer`, `roles/storage.objectAdmin` solo sobre el bucket de estado, permisos de solo lectura para plan/refresh, `serviceAccountUser` sobre las SA de runtime, etc.). No usa llaves JSON de cuenta de servicio.

## Prerrequisitos de GCP

- Terraform `>= 1.9.0, < 2.0.0` y provider `hashicorp/google` `~> 6.0` (lock en 6.50.0). El workflow fija Terraform 1.9.8.
- Identidad con permiso para operar el stack (en CI: la SA deploy vía WIF).
- APIs habilitadas por `project_services` (lista arriba).
- **Cloud Resource Manager API** (`cloudresourcemanager.googleapis.com`): está **habilitada en el proyecto** (fue necesaria para evitar `403 SERVICE_DISABLED` en operaciones de IAM/WIF). **Todavía no** está en los valores por defecto de `modules/project_services`. Hay que mantenerla habilitada fuera de ese módulo hasta que se declare allí.
- Pool y provider WIF existentes; binding de deploy gestionado por este stack.
- Versión del secreto `sports-demo-db-password` y usuario MySQL `sports_user` creados **fuera** del estado Terraform (habitualmente por Provision + `SPORTS_DB_PASSWORD`).
- Nombre del bucket de artifacts único en Cloud Storage.
- Para Provision: SA `sports-demo-provision` (root `persistent/`) y GitHub Secret `SPORTS_DB_PASSWORD`.

## Backend remoto

`versions.tf` declara el backend vacío:

```hcl
terraform {
  backend "gcs" {}
}
```

La conexión efectiva usa `backend.hcl` (ignorado por git; ejemplo en `backend.hcl.example`):

```hcl
bucket = "sports-tournaments-multicloud-tfstate"
prefix = "entrega3/main"
```

```bash
terraform init -backend-config=backend.hcl
```

Ese bucket **no** es el de artifacts. Lo crea y protege `bootstrap/`. Ver [`bootstrap/README.md`](bootstrap/README.md).

GitHub Actions escribe `backend.hcl` en el runner en cada job y autentica con WIF. La SA deploy necesita `roles/storage.objectAdmin` sobre ese bucket (no sobre el proyecto).

## Gestión de secretos

Terraform crea el contenedor del secreto y nada más. `google_secret_manager_secret_version` y `google_sql_user` no están declarados: guardarían la contraseña en el estado.

Camino habitual tras Destroy: workflow **Entrega 3 GCP Provision**, que lee el GitHub Secret `SPORTS_DB_PASSWORD` y ejecuta `scripts/entrega3_provision_db_credentials.py` (versión en Secret Manager + usuario MySQL vía Cloud SQL Admin API). La contraseña no va a Terraform, al estado ni a los logs del workflow.

Alternativa manual (otro proyecto / emergencia): añadir versión al secreto y crear `database_user` fuera de Terraform, sin dejar la contraseña en `terraform.tfvars` ni en el historial del shell; después Deploy con `deploy_applications = true`.

Cloud Run referencia el secreto como `DB_PASSWORD` con la versión `latest`. Una versión nueva no entra en una revisión ya desplegada hasta el siguiente despliegue del servicio.

## Advertencia: apply local e imágenes antiguas

`terraform.tfvars` **no se versiona**. Una copia local puede tener `deploy_applications = true` e imágenes etiquetadas con un SHA **anterior** al de `main`.

Si alguien ejecuta `terraform apply` local contra el backend remoto con esas rutas, el plan (y un apply sin el validador de CI) puede **revertir** las revisiones de Cloud Run a imágenes viejas y deshacer el último deploy de Actions.

Reglas prácticas:

- Preferir redespliegue con **Entrega 3 GCP Deploy** desde `main`.
- Si hace falta un plan/apply local, alinear `sports_image` y `object_storage_image` al SHA que deba quedar en producción **antes** de aplicar, o dejar que CI escriba esas variables.
- No copiar valores secretos a git. No documentar contraseñas aquí.

## Costos

Mientras Cloud SQL exista con `database_activation_policy = ALWAYS`, la instancia factura cómputo aunque no haya tráfico. El disco de 10 GB también factura. No hay alta disponibilidad, ni backups, ni crecimiento automático del disco, ni conector VPC.

Cloud Run queda en mínimo 0 y máximo 2, con la CPU en idle fuera de las peticiones. No factura instancias quietas. Las APIs habilitadas se quedan habilitadas al destruir el stack.

Entre usos académicos, `database_activation_policy = NEVER` detiene el cómputo y conserva el disco. Volver a `ALWAYS` antes de usar la API. Ese cambio, fuera del validador actual de CI, requiere un apply autorizado distinto del redespliegue de imágenes.

El bucket de estado factura almacenamiento Standard. Con un archivo de estado pequeño y unas pocas generaciones, el cargo esperado queda en centavos al mes.

## Destrucción controlada (manual)

No hay workflow Destroy. Es un procedimiento **manual** con autorización explícita, desde el root `terraform/` y el backend GCS `entrega3/main`.

### Comportamiento del destroy del stack principal

- `database_deletion_protection = false`: Cloud SQL se elimina con el destroy.
- `artifacts_force_destroy = true`: borra objetos del bucket de artifacts y luego el bucket. Los JSON `flujos/{traceId}.json` **no se recuperan**.
- Cloud Run: `deletion_protection = false` en el módulo.
- APIs: `disable_on_destroy = false` (siguen habilitadas).
- Usuario MySQL y versiones del secreto (fuera de Terraform) desaparecen con la instancia / quedan huérfanos según el caso.

**No entra en este destroy:**

- Bucket de estado (`bootstrap/`, otro estado, `prevent_destroy`).
- Stack `persistent/` (`sports-demo-provision` + WIF).
- Pool/provider WIF del proyecto.

### Procedimiento comprobado (ejecución real)

Desde un entorno con credenciales autorizadas y `backend.hcl` apuntando a `entrega3/main`:

```bash
cd terraform
terraform init -backend-config=backend.hcl
terraform destroy
```

Resultado reportado de la ejecución real:

| Métrica | Valor |
|---|---|
| Recursos creados | 0 |
| Recursos modificados | 0 |
| Recursos destruidos | **34** |
| Estado `entrega3/main` | Vacío tras el destroy |

### Secuencia para volver a desplegar tras Destroy

1. Confirmar que `persistent/` y el bucket de estado siguen vivos.
2. Actions → **Entrega 3 GCP Provision** → `main` → `PROVISION` (requiere secret `SPORTS_DB_PASSWORD`).
3. Si Cloud SQL falla por capacidad zonal y GCP deja la instancia creada fuera del estado: `terraform import` del recurso SQL y reejecutar Provision (ver incidencia abajo).
4. Actions → **Entrega 3 GCP Deploy** → `main` → `DEPLOY`.
5. Recrear datos de prueba (torneos/artifacts): **se pierden** con el destroy.

### Incidencia Cloud SQL (ejecución real)

Durante la reconstrucción, el primer Provision falló por **falta de capacidad** de Cloud SQL en `us-central1-f`. Google Cloud llegó a crear `sports-demo-mysql`, pero Terraform no lo incorporó al estado. Recuperación:

1. `terraform import` de la instancia (y recursos asociados según el plan) al estado `entrega3/main`.
2. Reejecución de **Entrega 3 GCP Provision #3** → Success.
3. **Entrega 3 GCP Deploy** sobre `7b79baf` → Success.

La reconstrucción fue **funcionalmente exitosa** y **no completamente automática**.

### Pérdida de datos

Tras Destroy del principal no hay recuperación automática de:

- Filas MySQL (sin backups en este stack).
- Objetos GCS `flujos/*.json`.
- Revisiones Cloud Run e imágenes no recreadas hasta Deploy.

### Cierre total de la entrega (opcional, otra autorización)

1. Destroy del stack principal (arriba).
2. Solo después: retirar Owner de provision / destruir `persistent/` si aplica.
3. Solo al final: bootstrap (quitar `prevent_destroy`, vaciar generaciones, destroy). No invertir el orden.

## Comprobaciones post-despliegue

```bash
gcloud sql instances describe sports-demo-mysql --project=sports-tournaments-multicloud --format='value(state)'
gcloud run services describe sports-demo-api --region=us-central1 --project=sports-tournaments-multicloud --format='value(status.conditions)'
gcloud run services describe sports-demo-storage --region=us-central1 --project=sports-tournaments-multicloud --format='value(status.conditions)'
gcloud storage ls gs://sports-tournaments-multicloud-demo-artifacts/flujos/
```

Pruebas funcionales E2E post-rebuild (reportadas): `GET /health/ready` en ambos servicios; `POST/GET /torneos`; `POST /api/v3/torneos/1/artifact`; lectura GCS y `GET /api/v2/artifacts/:traceId` con trace `e3-rebuild-58061a0a-f1e9-4571-9323-077e497ac860`. Detalle en el README raíz.

## Consideraciones para sustentación

- Distinguir **comprobado en GCP/Actions** (Destroy 34, Provision #3, Deploy, E2E) de **solo estático** (lectura de `.tf` / workflows sin reejecutarlos en esa sesión).
- Explicar los tres roots y por qué persistent sobrevive al destroy.
- Mostrar que la contraseña no está en el estado Terraform (`SPORTS_DB_PASSWORD` → script → Secret Manager / MySQL API).
- Mencionar el validador de Deploy y el rol IAM de `setIamPolicy` para el invoker.
- Ser explícito sobre la incidencia de capacidad Cloud SQL y el `import` manual.
- No afirmar reconstrucción 100 % automática.

## Limitaciones conocidas

- Cloud Resource Manager API está habilitada en el proyecto pero no declarada en `project_services`.
- El validador de Deploy permite update/create allowlist de Cloud Run (+ invoker); no sirve para cambios de SQL, IAM o buckets sin ajustar el workflow.
- `roles/cloudsql.client` es de proyecto: la cuenta de Sports puede conectar a cualquier instancia de ese proyecto.
- El acceso anónimo está en false. Pasarlo a true concedería `roles/run.invoker` a `allUsers`. Object Storage no autentica `x-trace-id`.
- Hotel, Cine y OTLP quedan con URL vacía en el tfvars que escribe CI. `GET /api/v2/flujo/...` sigue dependiendo de esos servicios si se invoca.
- Sports no abre el puerto hasta conectar con MySQL; la startup probe tolera ese arranque.
- Un apply local mal alineado puede revertir imágenes (sección anterior).
- Capacidad zonal de Cloud SQL puede exigir intervención manual (`import`) tras un Provision parcial.

## Qué se puede revisar en el repositorio

Sin credenciales se puede leer la configuración y comprobar que:

- no hay `google_sql_user`, `google_secret_manager_secret_version`, `random_password` ni llaves;
- no hay VPC ni conector;
- el backend GCS está declarado en `versions.tf`;
- Sports apunta a Object Storage y Object Storage no apunta a Sports;
- `.gitignore` ignora estado, tfvars reales, `backend.hcl` real y planes. Siguen versionables `*.tfvars.example`, `backend.hcl.example` y `.terraform.lock.hcl`.
