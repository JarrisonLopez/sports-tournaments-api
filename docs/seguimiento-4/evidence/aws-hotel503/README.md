# Evidencia — Hotel OCI HTTP 503

Procedimiento: `docs/seguimiento-4/EXPERIMENTO_HOTEL_503.md`  
Modos: `scripts/chaos/set_aws_hotel503_mode.ps1`  
Perfil k6: `load/k6/flujo-profile-shared.js`

| Ítem | Estado |
|---|---|
| Prueba local 503 (Vitest) | `npm run chaos:verify-hotel-503` |
| ConfigMaps R0/R1 | `k8s/aws/configmap.exp-hotel503-r0.yaml` / `…-r1.yaml` |
| Fallo real OCI | **Pendiente ventana Samuel** (no activar desde Sports) |

Cada corrida: carpeta `<RUN_ID>/` con verify k8s, k6 summaries y muestras curl.
