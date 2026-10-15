# Bootstrap del estado de Terraform

Esta carpeta declara el bucket que guardará el estado del stack principal. No es el bucket de artifacts JSON. No tiene backend remoto: su propio estado es local y `.gitignore` impide subirlo.

No ejecutes `terraform init`, `plan`, `apply` ni `destroy` aquí sin una autorización distinta de la del stack principal. Esta fase no crea el bucket.

## Qué crea, cuando se autorice

- La API `storage.googleapis.com`, sin desactivarla al destruir este root.
- Un bucket regional, privado, con acceso uniforme y prevención de acceso público.
- Versionado de objetos.
- `force_destroy = false`.
- `lifecycle.prevent_destroy`, para que un destroy accidental falle dentro de Terraform.
- Una regla de ciclo de vida que borra solo versiones `ARCHIVED` cuando ya existen al menos `noncurrent_versions_to_keep` versiones más nuevas. La generación viva del archivo de estado no cumple esa condición.

El soft delete del bucket queda en 0 segundos. El historial que se conserva es el del versionado, acotado por esa regla.

Con el ejemplo, el nombre es `sports-tournaments-multicloud-tfstate`, en `us-central1`. Si ese nombre ya existe en Cloud Storage, hay que elegir otro antes de cualquier apply. No se comprobó la disponibilidad del nombre.

## Procedimiento previsto

1. Copiar `terraform.tfvars.example` a `terraform.tfvars` dentro de esta carpeta. Ese archivo no se versiona.
2. Confirmar que el nombre del bucket no choca con el de artifacts ni con otro bucket global.
3. Con autorización, ejecutar aquí `terraform init` y revisar un plan. El init de esta fase no está autorizado.
4. Guardar el `terraform.tfstate` local de este directorio fuera del repositorio. Si se pierde, el bucket puede seguir existiendo y haría falta importarlo.
5. Solo después de que el bucket exista, el stack de `terraform/` puede pasar a backend GCS con `backend.hcl`.

No hay credenciales en estos archivos. El provider usa la identidad del entorno.

## Costo

El bucket no tiene cómputo. Un estado de Terraform suele ocupar kilobytes o unos pocos megabytes. El versionado conserva generaciones antiguas hasta el umbral configurado. El cargo esperado, con ese volumen en Standard y `us-central1`, se mantiene en centavos al mes. No sustituye el costo de Cloud SQL del stack principal.

## Cómo no borrarlo sin querer

`terraform destroy` del stack principal no incluye este bucket, porque vive en otro estado. Aquí, `prevent_destroy` detiene el destroy y `force_destroy = false` impide vaciar el bucket aunque alguien quite esa protección en un apply posterior.

Eliminarlo al cerrar la entrega es un acto aparte: primero destruir o migrar el stack principal, después una autorización explícita para quitar `prevent_destroy`, borrar las generaciones del objeto de estado y recién entonces destruir este root.
