# Entrega 3 — Infraestructura con Terraform

Esta carpeta declara la infraestructura de la Entrega 3 para el proyecto `sports-tournaments-multicloud`, en `us-central1`. La API individual es `POST /api/v3/torneos/:id/artifact`: Sports lee el torneo en MySQL y Object Storage lo guarda en Cloud Storage. V1 y V2 siguen en el código. `k8s/` sigue siendo la Entrega 2.

**Estado:** la configuración está aplicada. El estado remoto vive en el bucket `sports-tournaments-multicloud-tfstate`, prefijo `entrega3/main`. El despliegue verificable más reciente documentado es **Entrega 3 GCP Deploy #4** (commit `1986b45a35f6d7db922a98075aa787737ac181be`): apply con 0 creados, 2 modificados y 0 eliminados; ambos Cloud Run en `Ready=True`; imágenes publicadas en Artifact Registry con el SHA del commit. Los servicios son privados.

No ejecutes `terraform init`, `plan`, `apply` ni `destroy` sin autorización explícita. El camino habitual de redespliegue es GitHub Actions (sección siguiente), no un apply local.

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
├── bootstrap/
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
| `iam` | Cuentas de ejecución de Sports API y Object Storage, cuenta de CI `sports-demo-deploy`, permisos acotados y binding WIF (`roles/iam.workloadIdentityUser`) hacia el subject de GitHub en `main`. No crea el pool ni el provider OIDC (ya existen). No crea llaves JSON. |
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

## Despliegue desde GitHub Actions

Workflow: `.github/workflows/entrega3-gcp.yml` (`Entrega 3 GCP Deploy`).

1. Abrir Actions → **Entrega 3 GCP Deploy** → Run workflow.
2. Rama: `main` (`refs/heads/main`). Cualquier otra ref falla el job.
3. Input `confirm_deploy`: escribir exactamente `DEPLOY`.
4. No configurar GitHub Environment en ese workflow: cambiaría el subject OIDC y rompería el binding.

Pasos que ejecuta el job:

1. Autenticación WIF hacia `sports-demo-deploy@sports-tournaments-multicloud.iam.gserviceaccount.com`.
2. Build y push de `sports-api-v3:${GITHUB_SHA}` y `object-storage-v3:${GITHUB_SHA}` al repositorio `sports-demo-images`.
3. Escritura en el runner de `backend.hcl` y `terraform.tfvars` (no se versionan).
4. `terraform fmt -check`, `init -backend-config=backend.hcl`, `validate`, `plan`, validación del plan, `apply`.
5. Lectura de outputs y comprobación `Ready=True` en `sports-demo-api` y `sports-demo-storage`.

### Validador del plan

Tras `terraform plan -out=tfplan`, un script Python solo admite:

- recursos en `no-op`, o
- `update` de exactamente:
  - `module.sports_api[0].google_cloud_run_v2_service.service`
  - `module.object_storage_service[0].google_cloud_run_v2_service.service`

Cualquier create, delete, replace u update de otro recurso rechaza el job. Eso encaja con un stack ya provisionado que solo debe refrescar las revisiones de Cloud Run con las imágenes nuevas.

### Resultados del Deploy #4

| Dato | Valor |
|---|---|
| Commit | `1986b45a35f6d7db922a98075aa787737ac181be` |
| Duración | 2 minutos y 29 segundos |
| Apply | 0 creados, 2 modificados, 0 eliminados |
| Cloud Run | Ambos `Ready=True` |
| Imágenes | SHA del commit en Artifact Registry |
| Acceso | Privado (`allow_unauthenticated = false`) |

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
- Versión del secreto `sports-demo-db-password` y usuario MySQL `sports_user` creados **fuera** de Terraform (no van al estado).
- Nombre del bucket de artifacts único en Cloud Storage.

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

Procedimiento fuera del repositorio y fuera del estado (ya realizado para el despliegue actual; se documenta por si hay que repetirlo en otro proyecto):

1. Escribir la contraseña en un archivo temporal que no viva en este proyecto.
2. Añadir una versión a `db_password_secret_id` desde ese archivo.
3. Borrar el archivo temporal. No dejes la contraseña en el historial del shell ni en `terraform.tfvars`.
4. Crear el usuario `database_user` en la instancia, con esa misma contraseña y permiso DDL en `database_name` (`synchronize: true` en TypeORM).
5. Solo entonces desplegar Cloud Run con `deploy_applications = true`.

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

## Destrucción controlada (después de la sustentación)

`terraform destroy` del **stack principal** solo tiene sentido con autorización explícita y cuando ya no haga falta el entorno de demostración.

Con la configuración actual:

- `database_deletion_protection = false` desactiva el bloqueo de Terraform y el de la API de Cloud SQL. Si uno solo quedara en true, el destroy pediría un segundo apply o un cambio en la consola.
- `artifacts_force_destroy = true` borra los objetos del bucket de artifacts y después el bucket. Los JSON `flujos/{traceId}.json` no se recuperan. No hay versionado ni backups de MySQL.
- Cloud Run lleva `deletion_protection = false` dentro del módulo.
- Las APIs no se desactivan (`disable_on_destroy = false`).
- El usuario MySQL creado fuera de Terraform desaparece con la instancia; las versiones del secreto pueden quedar huérfanas. No hay recursos Terraform que los borren.

**El bucket de estado no entra en ese destroy.** Está en `bootstrap/`, con otro estado, `lifecycle.prevent_destroy` y `force_destroy = false`. Conservarlo después de destruir la API mantiene el historial del estado y un costo de almacenamiento pequeño.

Orden seguro al cerrar la entrega:

1. Autorizar y destruir el stack principal (`terraform/` con backend GCS).
2. Solo después, y con otra autorización, tratar el bootstrap: quitar `prevent_destroy`, vaciar generaciones si procede y destruir `bootstrap/`.
3. No invertir el orden: borrar el estado antes que los recursos deja IDs huérfanos en GCP.

Si una escritura del estado sale mal, el versionado del bucket guarda la generación anterior de `entrega3/main/default.tfstate`. Recuperarla consiste en restaurar esa generación como objeto vivo y revisar el resultado antes de otro apply.

El workflow de CI **no** ejecuta `destroy`. Es un procedimiento manual aparte.

## Limitaciones conocidas

- Cloud Resource Manager API está habilitada en el proyecto pero no declarada en `project_services`.
- El validador de CI solo permite actualizar los dos Cloud Run; no sirve para cambios de SQL, IAM o buckets sin ajustar el workflow.
- `roles/cloudsql.client` es de proyecto: la cuenta de Sports puede conectar a cualquier instancia de ese proyecto.
- El acceso anónimo está en false. Pasarlo a true concedería `roles/run.invoker` a `allUsers`. Object Storage no autentica `x-trace-id`.
- Hotel, Cine y OTLP quedan con URL vacía en el tfvars que escribe CI. `GET /api/v2/flujo/...` sigue dependiendo de esos servicios si se invoca.
- Sports no abre el puerto hasta conectar con MySQL; la startup probe tolera ese arranque.
- Un apply local mal alineado puede revertir imágenes (sección anterior).

## Qué se puede revisar en el repositorio

Sin credenciales se puede leer la configuración y comprobar que:

- no hay `google_sql_user`, `google_secret_manager_secret_version`, `random_password` ni llaves;
- no hay VPC ni conector;
- el backend GCS está declarado en `versions.tf`;
- Sports apunta a Object Storage y Object Storage no apunta a Sports;
- `.gitignore` ignora estado, tfvars reales, `backend.hcl` real y planes. Siguen versionables `*.tfvars.example`, `backend.hcl.example` y `.terraform.lock.hcl`.
