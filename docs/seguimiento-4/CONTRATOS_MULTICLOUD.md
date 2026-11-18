# Contratos multicloud — Seguimiento #4

Sports (AWS / Kubernetes) es el **coordinador síncrono** del flujo evaluado.

## Flujo evaluado

```text
GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId
Headers:
  x-trace-id: <id-negocio>          (obligatorio en la práctica de demo)
  traceparent: <w3c>                (opcional; si falta, Sports crea span raíz)

Secuencia (FLUJO_ORCHESTRATION_MODE=sequential, default):
  1. Sports lee torneo local (MySQL)
  2. Sports → Hotel OCI  GET /api/v2/habitacion/:id   (espera respuesta)
  3. Sports → Cine GCP   GET /api/v2/peliculas/:id    (espera respuesta)
  4. Sports responde JSON integrado
  5. Object Storage es opcional si OBJECT_STORAGE_API_URL está vacío
```

Modo `parallel` (`FLUJO_ORCHESTRATION_MODE=parallel`) conserva `Promise.all` histórico y **no** es el modo del experimento de latencia.

## Qué necesita configurar Samuel (Hotel / OCI)

| Variable / recurso | Valor esperado |
|---|---|
| URL pública Hotel | Base URL sin slash final, alcanzable desde Sports AWS |
| Endpoint | `GET /api/v2/habitacion/:id` |
| Cabeceras entrantes | Debe aceptar `x-trace-id` y, si es posible, `traceparent` / `tracestate` |
| Respuesta 200 | JSON con al menos: `id`, `numeroHabitacion`, `precioHabitacion` (number **o** string decimal), `estadoHabitacion`, `tipoHabitacion` |
| Errores | 404 si no existe; 5xx si falla interno |
| Health | Recomendado `GET /health/live` o equivalente para preflight |
| Observabilidad | Reenviar/registrar `x-trace-id`; exportar OTLP al Collector/Grafana compartido |
| Chaos | **No** inyectar fallos en Hotel para el experimento de Jarrison; la latencia se inyecta en el **cliente Sports → Hotel** |

Ejemplo de respuesta esperada:

```json
{
  "id": 1,
  "numeroHabitacion": "101",
  "precioHabitacion": 120000,
  "estadoHabitacion": "disponible",
  "tipoHabitacion": "standard"
}
```

Variable en Sports (activa):

```text
HOTEL_API_URL=http://149.130.165.30
```

## Qué necesita configurar Daniel (Cine / GCP)

| Variable / recurso | Valor esperado |
|---|---|
| URL pública Cine | Base URL sin slash final |
| Endpoint | `GET /api/v2/peliculas/:id` (prefijo `/api/v2` + ruta `/peliculas/:id` del repo) |
| Cabeceras | Aceptar `x-trace-id` (el código V2 de Cine ya lo usa) y `traceparent` si es posible |
| Respuesta 200 | Plano `{id,nombre,...}` **o** sobre `{ origen, traceId, pelicula:{...} }` (Sports acepta ambos) |
| Errores | 404 / 5xx coherentes |
| Health | `GET /api/v2/health` u otro health documentado |
| Observabilidad | Correlación por `x-trace-id` + OTLP hacia Grafana compartido |

Ejemplo:

```json
{
  "id": 1,
  "nombre": "Demo",
  "duracion": 120,
  "genero": "accion",
  "descripcion": "pelicula de laboratorio"
}
```

Variable en Sports (activa):

```text
CINE_API_URL=http://35.239.107.54
```

## Cabeceras que Sports envía

| Header | Obligatorio | Notas |
|---|---|---|
| `x-trace-id` | Sí | Identificador de negocio del flujo |
| `traceparent` | Sí si hay span activo | W3C Trace Context |
| `tracestate` | Si existe en contexto | Se propaga tal cual |

## Variables Sports relevantes

```text
HOTEL_API_URL=
CINE_API_URL=
OBJECT_STORAGE_API_URL=          # vacío = omitir persistencia GCS en lab
FLUJO_ORCHESTRATION_MODE=sequential
OTEL_SERVICE_NAME=sports-api
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-lab.local:31443
OTEL_EXPORTER_OTLP_CERTIFICATE=/etc/otel/otel-lab-ca.crt
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic …  # Secret; no ConfigMap
HOTEL_TIMEOUT_MS=2000
RESILIENCE_ENABLED=true|false    # false en R0, true en R1 (solo lab)
CHAOS_LAB_ENABLED=true|false
CHAOS_FAULT_TOKEN=               # >=32 chars; no es auth pública arbitraria
```

Collector OCI (Samuel): ver `OTLP_OCI.md`. Perfil k6 compartido: `load/k6/flujo-profile-shared.js`.

## Estado de verificación remota

Los repositorios públicos confirman las rutas:

- Hotel: `GET /api/v2/habitacion/:id` (Samuel)
- Cine: `GET /api/v2/peliculas/:id` (Daniel, con prefix `/api/v2`)

La **disponibilidad en OCI/GCP** no está verificada desde este repositorio. Hasta tener URLs estables, Sports usa mocks HTTP locales (`lab/mocks`).

## Checklist de integración

1. Samuel publica URL Hotel + id de habitación de prueba.
2. Daniel publica URL Cine + id de película de prueba.
3. Sports actualiza ConfigMap / env con esas URLs.
4. Se ejecuta un flujo manual con el mismo `x-trace-id` y se confirma traza en Grafana.
5. Solo entonces se autoriza el experimento de latencia inter-nube.
6. Ejecutar `.\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud` (ver `EXPERIMENTO_INTERCLOUD.md`).
