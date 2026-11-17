# Experimento intercloud — latencia Sports AWS → Hotel OCI

## Requisito de rúbrica

Inyectar latencia en una **llamada saliente** desde Sports (AWS) hacia Hotel (OCI real), medir Baseline/R0/R1 y revertir.

## Mecanismo (ya en código)

| Aspecto | Detalle |
|---|---|
| Punto de inyección | `applyHotelLatencyIfActive` en `hotel.client.ts` **antes** del `fetch` a `HOTEL_API_URL` |
| Destino | URL real `http://149.130.165.30` (no mock) |
| Qué no se toca | Pods/servicios de Samuel (OCI), Cine GCP |
| Activación | `POST /chaos/hotel-latency` + token + `CHAOS_LAB_ENABLED=true` |
| TTL / revert | TTL automático + `DELETE` multi-pod |
| Evidencia destino | `targetBaseUrl`, `targetsRealHotel`, `injectionPoint` en GET state |
| Resiliencia R1 | timeout 400 ms + CB + fallback (parcial ≠ full) |

El experimento con mocks (`aws-rounds-20261116215016`) **se conserva**; este es el complemento intercloud.

## Umbrales a priori (no ajustar a posteriori)

- Disponibilidad R1 (full+partial) ≥ 90%
- p95 R1 ≤ 70% del p95 R0
- Parcial no cuenta como éxito completo
- Latencia inyectada: **800 ms**
- Perfil k6: `flujo-profile.js` (15s@2 → 45s@4 → 15s@0) — carga moderada

## ConfigMaps temporales

- R0/Baseline: `k8s/aws/configmap.exp-intercloud-r0.yaml` (OCI+GCP, caos on, resiliencia off)
- R1: `k8s/aws/configmap.exp-intercloud-r1.yaml` (OCI+GCP, caos on, resiliencia on)
- Restaurar: `k8s/aws/configmap.yaml`

## Autorización Samuel

**No armar el fallo contra Hotel OCI sin ventana acordada.**

Checklist previos (CONTRATOS):

1. URL Hotel + id de prueba (hecho).
2. URL Cine + id (hecho).
3. Flujo steady `status=success` sin fallback (verificar antes).
4. Samuel confirma ventana de pruebas.
5. Ejecutar con `-AuthorizeIntercloud`.

## Comandos

```powershell
# 1) Preparación / dry-run (NO inyecta)
.\scripts\chaos\run_aws_intercloud_rounds.ps1 -BaseUrl "http://3.21.120.51:30080"

# 2) Tras acuerdo con Samuel (SÍ inyecta + restaura)
.\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud -BaseUrl "http://3.21.120.51:30080"
```

Declarativo Chaos Toolkit: `chaos/experiments/hotel-latency-intercloud.yaml`  
Helpers multi-pod: `scripts/chaos/aws-lab-helpers.sh`

## Aborto

- `/health/ready` ≠ 200
- Flujo sin providers OCI/GCP o con mocks
- `targetsRealHotel != true` al armar (imagen actualizada)
- Armado en < 2 réplicas

## Evidencias

- Dry-run / preparación: `docs/seguimiento-4/evidence/aws-intercloud/`
- Live (cuando exista): mismo directorio + `comparison.json` + k6 summaries
- Experimento mocks previo: `docs/seguimiento-4/evidence/aws-rounds/aws-rounds-20261116215016/`

## Estado

| Ítem | Estado |
|---|---|
| Mecanismo saliente Sports→Hotel | Listo |
| Config/scripts intercloud | Listos |
| Dry-run preflight | Ejecutar script sin `-AuthorizeIntercloud` |
| Rondas live vs OCI | **Pendiente autorización Samuel** |
