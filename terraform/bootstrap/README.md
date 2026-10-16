# Bootstrap del estado de Terraform

Esta carpeta declara el bucket que guarda el estado remoto del stack principal de la Entrega 3. **No** es el bucket de artifacts JSON.

**Estado:** el bucket `sports-tournaments-multicloud-tfstate` **ya está creado y en uso**. El stack de `terraform/` y el workflow `Entrega 3 GCP Deploy` apuntan a ese bucket con el prefijo `entrega3/main`.

Este root no tiene backend remoto: su propio estado es **local** y `.gitignore` impide subirlo. Guardar una copia segura de ese `terraform.tfstate` local fuera del repositorio.

No ejecutes `terraform init`, `plan`, `apply` ni `destroy` aquí sin una autorización **distinta** de la del stack principal.

## Qué gestiona

- La API `storage.googleapis.com`, sin desactivarla al destruir este root.
- Un bucket regional, privado, con acceso uniforme y prevención de acceso público.
- Versionado de objetos (generaciones del archivo de estado).
- `force_destroy = false`.
- `lifecycle.prevent_destroy`, para que un destroy accidental falle dentro de Terraform.
- Una regla de ciclo de vida que borra solo versiones `ARCHIVED` cuando ya existen al menos `noncurrent_versions_to_keep` versiones más nuevas. La generación viva del archivo de estado no cumple esa condición.

El soft delete del bucket queda en 0 segundos. El historial que se conserva es el del versionado, acotado por esa regla.

Nombre en uso: `sports-tournaments-multicloud-tfstate`, región `us-central1`.

## Independencia respecto al stack principal

| Aspecto | `terraform/` (stack principal) | `terraform/bootstrap/` |
|---|---|---|
| Estado | Remoto GCS (`entrega3/main`) | Local en esta carpeta |
| Recursos típicos | Cloud Run, Cloud SQL, AR, IAM, artifacts, etc. | Solo el bucket de tfstate (+ API Storage) |
| `terraform destroy` del otro | No borra este bucket | No borra Cloud Run ni Cloud SQL |

Un `terraform destroy` en `terraform/` **no** incluye este bucket. Un destroy aquí **no** elimina los recursos del stack principal; si se borra el estado remoto antes de tiempo, Terraform deja de conocer los IDs y los recursos pueden quedar huérfanos en GCP.

## Costo

El bucket no tiene cómputo. Un estado de Terraform suele ocupar kilobytes o unos pocos megabytes. El versionado conserva generaciones antiguas hasta el umbral configurado. El cargo esperado, con ese volumen en Standard y `us-central1`, se mantiene en centavos al mes. No sustituye el costo de Cloud SQL del stack principal.

## Cómo no borrarlo sin querer

`prevent_destroy` detiene el destroy de Terraform. `force_destroy = false` impide vaciar el bucket aunque alguien quite esa protección en un apply posterior sin vaciar objetos primero.

## Orden seguro de destrucción (después de la sustentación)

1. Autorizar y destruir el **stack principal** (`terraform/`), con su backend GCS todavía disponible.
2. Confirmar que ya no hacen falta los recursos de la Entrega 3 en GCP.
3. Con **otra** autorización explícita: quitar `prevent_destroy` en este root, borrar las generaciones del objeto de estado si procede, y solo entonces destruir este bootstrap.
4. No invertir el orden: destruir el bucket de estado mientras el stack principal siga vivo (o sin haber destruido/importado sus recursos) deja de haber un mapa fiable de IDs.

Si se pierde el `terraform.tfstate` local de esta carpeta pero el bucket sigue existiendo, haría falta importarlo en un procedimiento aparte antes de gestionarlo de nuevo con Terraform.
