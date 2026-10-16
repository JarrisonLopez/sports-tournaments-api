# Stack persistente (Entrega 3)

Root Terraform independiente para la **identidad de aprovisionamiento** que debe sobrevivir a un `terraform destroy` del stack principal (`terraform/`, prefijo `entrega3/main`).

**Estado operativo:** esta configuración **ya está aplicada** en el proyecto `sports-tournaments-multicloud`. En GCP existen la SA `sports-demo-provision`, su binding WIF hacia GitHub Actions en `main` y el binding temporal `roles/owner` de proyecto. El estado remoto vive en el bucket `sports-tournaments-multicloud-tfstate`, prefijo `entrega3/persistent`.

Este root **no** administra Secret Manager ni la contraseña MySQL.

## Objetivo

Conservar la identidad con la que GitHub Actions puede volver a **Provision** el stack reconstruible, sin depender de la SA `sports-demo-deploy` del stack principal (esa SA se destruye con `entrega3/main`).

No hay workflow Destroy en la Entrega 3: el `terraform destroy` del stack principal se ejecuta **manualmente** desde `terraform/` (backend `entrega3/main`). Este root y `bootstrap/` se conservan; la reconstrucción usa Provision y luego Deploy.

| Workflow / procedimiento | Identidad |
|---|---|
| Entrega 3 GCP Provision | `sports-demo-provision` (este root) |
| Entrega 3 GCP Deploy | `sports-demo-deploy` (stack principal; permisos acotados) |
| Terraform Destroy del principal | Manual desde `terraform/` (no hay workflow; no usa esta SA por CI) |

La contraseña MySQL para reconstrucción se obtiene desde el secreto de repositorio de GitHub Actions `SPORTS_DB_PASSWORD` (fuera de Terraform). El contenedor Secret Manager `sports-demo-db-password` permanece en el **stack principal** y puede destruirse/reconstruirse con él.

## Separación de roots

| Root | Prefijo / estado | Rol |
|---|---|---|
| `terraform/bootstrap/` | Estado **local** | Bucket del tfstate (`sports-tournaments-multicloud-tfstate`) |
| `terraform/persistent/` | GCS `entrega3/persistent` | SA provision + WIF + Owner temporal |
| `terraform/` | GCS `entrega3/main` | Stack reconstruible (SQL, secreto DB, AR, artifacts, Cloud Run, SA deploy) |

Un `destroy` de `entrega3/main` **no** elimina este root. Un `destroy` de este root **sí** elimina la SA provision y el Owner (solo con autorización distinta y explícita).

## Qué declara

- Cuenta de servicio `sports-demo-provision` (sin llaves JSON).
- Binding `roles/iam.workloadIdentityUser` hacia el subject OIDC de GitHub Actions en `refs/heads/main`.
- Binding de proyecto `roles/owner` **solo** para `sports-demo-provision` (temporal; ver riesgos).
- Backend GCS: bucket del bootstrap, prefijo `entrega3/persistent`.

## Qué no declara

- Secret Manager ni versiones de secretos (viven en `terraform/`).
- Pool/provider WIF (ya existen fuera de Terraform: `github-actions-pool` / `github-provider`).
- El bucket de estado (lo crea `bootstrap/`).
- Cloud Run, Cloud SQL, Artifact Registry, bucket de artifacts ni SAs de runtime/deploy.

## Dependencias antes de Provision

Antes de ejecutar el workflow **Entrega 3 GCP Provision** hace falta:

1. Bucket de estado (bootstrap) y backend `entrega3/main` utilizable.
2. Este root **aplicado** (SA `sports-demo-provision` + WIF + permisos).
3. Pool/provider WIF existentes y subject OIDC de `main` alineado.
4. Secreto de repositorio GitHub `SPORTS_DB_PASSWORD` configurado (no va en Terraform).
5. Código del stack principal en `terraform/` coherente con el workflow.

Provision **no** sustituye a Deploy: deja `deploy_applications = false` y prepara la base; Deploy publica imágenes y crea/actualiza Cloud Run.

## Cuenta de servicio

```text
sports-demo-provision@sports-tournaments-multicloud.iam.gserviceaccount.com
```

Subject OIDC autorizado (valores por defecto / ejemplo):

```text
repo:JarrisonLopez@140736138/sports-tournaments-api@1349259895:ref:refs/heads/main
```

Principal WIF:

```text
principal://iam.googleapis.com/projects/171179411205/locations/global/workloadIdentityPools/github-actions-pool/subject/repo:JarrisonLopez@140736138/sports-tournaments-api@1349259895:ref:refs/heads/main
```

No usar GitHub `environment:` en Provision (ni en Deploy) si eso cambia el claim `sub` y rompe este binding.

## Verificar el estado sin modificar recursos

Con credenciales de lectura y este directorio configurado (`backend.hcl` + `terraform.tfvars` locales, no versionados):

```bash
cd terraform/persistent
terraform init -input=false -backend-config=backend.hcl
terraform plan -input=false -refresh-only
# o, si se prefiere un plan normal y el stack no ha driftado:
terraform plan -input=false
```

Un plan vacío (o solo refresh) indica que el código coincide con lo aplicado. **No** ejecutar `apply` ni `destroy` sin autorización.

Comprobaciones puntuales en GCP (solo lectura), por ejemplo:

- Existencia de la SA `sports-demo-provision`.
- Binding WIF `roles/iam.workloadIdentityUser` para el subject de `main`.
- Binding de proyecto `roles/owner` para esa SA (mientras siga el modo temporal).

## Recuperación (procedimiento general)

Tras un **Destroy manual** del stack principal (`cd terraform`, backend `entrega3/main`), este root y `bootstrap/` deben seguir disponibles:

1. Confirmar que este root sigue aplicado (plan no-op / SA presente) y que el bucket de estado sigue intacto.
2. Ejecutar **Entrega 3 GCP Provision** desde `main` (confirmación `PROVISION`).
3. Ejecutar **Entrega 3 GCP Deploy** (confirmación `DEPLOY`) para imágenes y Cloud Run.

No existe (ni se prevé) un workflow de Destroy: solo el procedimiento Terraform manual del root principal, seguido de Provision y Deploy en Actions.

## Riesgo: `roles/owner` temporal

Se concedió `roles/owner` a `sports-demo-provision` para simplificar el workflow **Provision** en un proyecto académico dedicado.

- No ampliar Owner a `sports-demo-deploy`.
- Al finalizar la demostración: **retirar** el binding Owner o destruir este root con autorización explícita.
- Objetivo posterior: sustituir Owner por roles de mínimo privilegio.

## Archivos

```text
persistent/
├── versions.tf
├── providers.tf
├── variables.tf
├── main.tf
├── outputs.tf
├── backend.hcl.example
├── terraform.tfvars.example
├── .terraform.lock.hcl
└── README.md
```

**No versionar** (ya cubiertos por `.gitignore` del repo): `backend.hcl`, `terraform.tfvars`, `.terraform/`, `*.tfstate*`, `*.tfplan` / `persistent.tfplan`.

## Preparación local (sin apply)

```bash
cd terraform/persistent
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars

terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

`init` con backend GCS, `plan` y `apply` contra el estado remoto requieren autorización explícita.
