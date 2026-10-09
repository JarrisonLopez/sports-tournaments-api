# Entrega 3 — Infraestructura con Terraform

Esta carpeta describe la infraestructura de la Entrega 3 para el proyecto `sports-tournaments-multicloud`, en `us-central1`. Los módulos ya están escritos. No hay estado, no hay backend remoto y no se ha creado ningún recurso. `k8s/` sigue siendo la Entrega 2.

No ejecutes `terraform init`, `plan`, `apply` ni `destroy` sin autorización explícita.

## Arquitectura de los módulos

```text
terraform/
├── versions.tf
├── providers.tf
├── variables.tf
├── outputs.tf
├── main.tf
├── terraform.tfvars.example
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
| `project_services` | APIs de Cloud Run, Cloud SQL Admin, Artifact Registry, Cloud Storage, Secret Manager, IAM, IAM Credentials, STS y Service Usage. `disable_on_destroy` queda en false. |
| `artifact_registry` | Un repositorio Docker regional, sin políticas de limpieza. |
| `cloud_storage` | Bucket privado de artifacts, acceso uniforme y acceso público bloqueado. |
| `secret_manager` | Solo el contenedor del secreto de la contraseña. No crea una versión. |
| `cloud_sql` | Instancia MySQL zonal Enterprise, `edition = "ENTERPRISE"`, disco PD_SSD fijo y la base. No crea el usuario. |
| `iam` | Cuentas de ejecución de Sports API y Object Storage, con permisos acotados. No crea Workload Identity Federation ni llaves. |
| `cloud_run_service` | Un `google_cloud_run_v2_service` reutilizable. `main.tf` lo instancia dos veces cuando `deploy_applications` es true. |

Con el prefijo de ejemplo `sports-demo`, los nombres quedan así:

| Recurso | Nombre |
|---|---|
| Repositorio | `sports-demo-images` |
| Instancia MySQL | `sports-demo-mysql` |
| Secreto | `sports-demo-db-password` |
| Cuenta y servicio de Sports | `sports-demo-api` |
| Cuenta y servicio de Object Storage | `sports-demo-storage` |
| Bucket | El valor de `artifacts_bucket_name` |

Cloud Run escucha en el puerto 8080 y el módulo fija `PORT` con ese mismo valor. `src/index.ts` y `object-storage/src/index.ts` usan `PORT`. Sports recibe el socket de Cloud SQL en `/cloudsql/<connection name>`, que es lo que lee `src/config/database.ts` cuando existe `CLOUD_SQL_CONNECTION_NAME`. La contraseña entra por `DB_PASSWORD`, que el código acepta en `src/config/db-password.ts`. Object Storage recibe `GCS_BUCKET_NAME` y no monta Cloud SQL.

Sports depende de la URL de Object Storage. Object Storage no llama a Sports. Esa dependencia se resuelve en un solo apply: no hace falta un segundo despliegue para conocer la URL y no hay ciclo.

`deploy_applications` nace en false. Con el ejemplo actual, Cloud Run no entra en el grafo. Así no se pide una imagen que todavía no existe.

## Orden de aprovisionamiento

Cuando haya autorización, el orden seguro es este:

1. Revisar `database_version` y `database_tier`. El ejemplo ya trae `MYSQL_8_4` y `db-f1-micro`. El módulo fija `edition = "ENTERPRISE"` para que MySQL 8.4 no caiga en Enterprise Plus. Esos valores salen de la documentación de Google Cloud y del provider `hashicorp/google` 6.49. No se han comprobado con `terraform plan`.
2. Copiar `terraform.tfvars.example` a `terraform.tfvars` y revisar el nombre del bucket. `terraform.tfvars` no se versiona.
3. Aplicar con `deploy_applications = false`. Eso crearía APIs, Artifact Registry, el bucket, el contenedor del secreto, Cloud SQL, la base y las cuentas. No crea Cloud Run, ni la versión del secreto, ni el usuario MySQL.
4. Cargar la contraseña fuera de Terraform y crear el usuario de aplicación con permiso DDL. El detalle está más abajo.
5. Construir y publicar las dos imágenes en el repositorio de esta configuración.
6. Poner las rutas reales en `sports_image` y `object_storage_image`, cambiar `deploy_applications` a true y aplicar otra vez. En ese apply, Object Storage se crea primero y Sports recibe su URL, `DB_PASSWORD` como referencia al secreto y el socket de Cloud SQL.

Hotel, Cine y OpenTelemetry quedan vacíos hasta que alguien confirme las URL. El CRUD no las necesita. `GET /api/v2/flujo/...` falla si Hotel, Cine u Object Storage no responden. Sports no abre el puerto hasta que MySQL acepta la conexión, porque `src/index.ts` escucha después de `AppDataSource.initialize()`.

## Prerrequisitos

- Terraform `>= 1.9.0, < 2.0.0` y provider `hashicorp/google` `~> 6.0`. La raíz lo declara en `versions.tf` y cada módulo repite `required_providers` con la misma restricción. El parche exacto aparecerá en `.terraform.lock.hcl` solo después de un init autorizado.
- Una identidad con permiso para crear estos recursos. Esta carpeta no trae credenciales ni un archivo de cuenta de servicio.
- El provider se configura solo con `project_id` y `region`.
- Confirmar que el nombre `sports-demo-mysql` no sigue reservado por la instancia anterior.
- Confirmar que el nombre del bucket es único en Cloud Storage.

## Bootstrap de imágenes

El repositorio Docker previsto es la salida `artifact_registry_repository`. Las imágenes de ejemplo (`REGION-docker.pkg.dev/...`) son marcadores. Con `deploy_applications = true`, la validación las rechaza.

Cuando el repositorio exista, la construcción esperada es:

- Sports API, con el `Dockerfile` de la raíz y contexto en la raíz del repositorio.
- Object Storage, con `object-storage/Dockerfile` y contexto en `object-storage/`.

Esas imágenes se etiquetan bajo `sports-demo-images`. Este paso no está automatizado: los workflows actuales no publican imágenes.

## Gestión de secretos

Terraform crea el contenedor y nada más. `google_secret_manager_secret_version` guardaría `secret_data` en el estado. `google_sql_user` guardaría `password` en el estado. Ninguno de los dos recursos está declarado.

Procedimiento previsto, fuera del repositorio y fuera del estado:

1. Escribir la contraseña en un archivo temporal que no viva en este proyecto.
2. Añadir una versión a `db_password_secret_id` desde ese archivo.
3. Borrar el archivo temporal. No dejes la contraseña en el historial del shell ni en `terraform.tfvars`.
4. Crear el usuario `database_user` en la instancia, con esa misma contraseña y con permiso para crear y alterar tablas en `database_name`. Hace falta DDL porque `src/config/database.ts` usa `synchronize: true`.
5. Solo entonces poner `deploy_applications` en true.

Cloud Run referencia el secreto como `DB_PASSWORD` con la versión `latest`. El estado guarda el identificador, no el valor. Una versión nueva no entra en una revisión ya desplegada hasta el siguiente despliegue del servicio.

Al destruir la instancia, el usuario creado fuera de Terraform se va con ella. No queda un usuario huérfano que Terraform tenga que borrar.

## Backend remoto

Sigue pendiente. No hay bloque `backend`. Un backend GCS necesita un bucket de estado creado aparte, con versionado, y ese bucket no debe entrar en el destroy de esta demo. `.terraform.lock.hcl` se versiona cuando exista. El estado local no debe commitearse: `.gitignore` ya cubre `.terraform/`, `*.tfstate`, el lock de estado y los planes binarios.

## Costos

Nada de esta carpeta ha creado recursos. Cuando un apply autorizado cree Cloud SQL, la instancia factura cómputo mientras `database_activation_policy` sea `ALWAYS`, aunque no haya tráfico. El disco de 10 GB también factura. No hay alta disponibilidad, ni backups, ni crecimiento automático del disco, ni conector VPC.

Cloud Run queda en mínimo 0 y máximo 2, con CPU solo durante el arranque y las peticiones. No factura instancias quietas. Las APIs habilitadas se quedan habilitadas al destruir el stack; habilitarlas no sustituye el costo de Cloud SQL.

Entre usos, `database_activation_policy = NEVER` detiene el cómputo y conserva el disco. Volver a `ALWAYS` antes de usar la API.

## Destrucción controlada

`terraform destroy` solo tiene sentido cuando el estado ya gestiona recursos y hay autorización explícita.

Con el ejemplo actual:

- `database_deletion_protection = false` pone en false el bloqueo de Terraform (`deletion_protection`) y el de la API de Cloud SQL (`deletion_protection_enabled`). Si uno solo quedara en true, el destroy pediría un segundo apply o un cambio en la consola.
- `artifacts_force_destroy = true` borra los objetos del bucket y después el bucket. Los JSON `flujos/{traceId}.json` no se recuperan. No hay versionado ni backups de MySQL.
- Cloud Run lleva `deletion_protection = false` dentro del módulo.
- Las APIs no se desactivan.

El bucket de estado, cuando exista en otra configuración, no forma parte de este destroy.

## Limitaciones pendientes

- La combinación `MYSQL_8_4`, `ENTERPRISE`, `db-f1-micro` y `PD_SSD` de 10 GB está documentada, pero ningún plan la ha enviado a la API. `db-f1-micro` tiene 0,614 GB de RAM. Si la API no arranca por memoria, el siguiente tier shared-core es `db-g1-small`, no un tier Enterprise Plus.
- El usuario MySQL y la versión del secreto son un paso manual anterior a Cloud Run. Sin ellos, Sports no llega a escuchar.
- `roles/cloudsql.client` es de proyecto: la cuenta de Sports puede conectar a cualquier instancia de ese proyecto. El proyecto de esta entrega tiene una sola instancia prevista.
- `roles/storage.objectUser` permite leer y escribir objetos del bucket, no administrarlo. Si el cliente de GCS también exige leer metadatos del bucket, el primer despliegue autorizado lo va a mostrar. No se concede `roles/storage.admin`, `roles/editor` ni `roles/owner`.
- El acceso anónimo está en false. Pasarlo a true concede `roles/run.invoker` a `allUsers`. Object Storage no autentica `x-trace-id`. Una política de organización puede bloquear `allUsers`; no hay un atajo en esta configuración.
- Workload Identity Federation de GitHub Actions no está creada. Faltan el pool, el provider OIDC y el binding. No hay llaves JSON.
- Puede hacer falta confirmar, en el primer plan, que el agente de Cloud Run del proyecto puede leer Artifact Registry y que los límites de las sondas de arranque son válidos. Sports espera hasta unos 120 segundos a que el puerto abra, porque no escucha hasta conectar con MySQL.
- El schema del provider 6.49 documenta `deletion_protection` en Cloud Run y queda en false en el módulo. El parche concreto del provider sigue sin fijarse porque no existe `.terraform.lock.hcl`.

## Qué se puede revisar sin desplegar

Sin `init` ni credenciales se puede leer la configuración y comprobar que:

- no hay `google_sql_user`, `google_secret_manager_secret_version`, `random_password`, llaves ni URLs de Hotel, Cine o Grafana;
- no hay VPC ni conector;
- Cloud Run no se instancia con `deploy_applications = false`;
- Sports apunta a Object Storage y Object Storage no apunta a Sports;
- `.gitignore` sigue ignorando estado, tfvars reales y planes, y sigue permitiendo `*.tfvars.example` y `.terraform.lock.hcl`.

`terraform fmt`, `terraform init -backend=false` y `terraform validate` no se ejecutaron en esta revisión: Terraform no está instalado en el equipo. Instalarlo y repetir esos comandos es el paso siguiente, todavía sin `plan`.
