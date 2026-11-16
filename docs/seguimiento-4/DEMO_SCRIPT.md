# Guion técnico de demostración — Seguimiento #4

1. **Kubernetes 2 réplicas**  
   `kubectl -n sports-lab get deploy,pods -l app=sports-tournaments-api`  
   Mostrar `replicas: 2` y probes en `k8s/aws/deployment.yaml`. Si AWS no está up: dry-run/local kind.

2. **Endpoint Sports**  
   `curl http://<host>:30080/health/ready` y `GET /`

3. **Integración Hotel + Cine**  
   Con mocks o URLs reales:  
   `curl -H "x-trace-id: demo-1" http://<host>:30080/api/v2/flujo/1/1/1`

4. **Trace ID**  
   Mostrar header de respuesta `x-trace-id` y spans `flujo.multicloud` / `hotel.get_habitacion` / `cine.get_pelicula` en Grafana (si disponible).

5. **Inyección de latencia**  
   `CHAOS_LAB_ENABLED=true` + `POST /chaos/hotel-latency` con token.  
   `GET /chaos/hotel-latency` → enabled true.

6. **Circuit breaker / timeout**  
   Ejecutar `npm run chaos:rounds` y mostrar `errorNames` de R1 (`HotelTimeoutError`, `CircuitOpenError`).

7. **Métricas**  
   Abrir `chaos/results/rounds-latest.json` (p95 R0 vs R1).

8. **Reversión**  
   `DELETE /chaos/hotel-latency` + GET enabled false.

9. **Comparación R0/R1**  
   Tabla del informe: p95, SLO, wall-clock.
