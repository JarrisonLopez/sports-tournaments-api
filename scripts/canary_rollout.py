#!/usr/bin/env python3
"""Decisiones locales del canary de sports-demo-api.

No abre red. Construye los comandos de gcloud y Monitoring para que un
workflow autorizado los ejecute después. Un fallo de consulta o una serie
ausente no es cero errores y no promociona.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from cloud_monitoring import (
    MIN_OBSERVATION_SECONDS,
    REQUEST_COUNT,
    REQUEST_LATENCIES,
    aggregate_revision,
    closed_window,
    gcloud_monitoring_argv,
    monitoring_filter as native_monitoring_filter,
)

# Umbrales de demostración académica. No son SLO calibrados en producción.
DEMO_MIN_SAMPLES = 30
DEMO_MAX_ERROR_RATE = 0.05
DEMO_MAX_ERROR_DELTA = 0.02
DEMO_MAX_P95_MS = 1500.0
DEMO_MAX_P95_RATIO = 2.0
DEMO_OBSERVATION_SECONDS = MIN_OBSERVATION_SECONDS
DEMO_MAX_WAIT_SECONDS = 600
DEMO_METRIC_RETRIES = 3
MAX_DEMO_REQUESTS = 800
MAX_DEMO_CONCURRENCY = 4
MAX_DEMO_DURATION_SECONDS = 240

TRAFFIC_STEPS = ((100, 0), (90, 10), (0, 100))
PROMOTION_TRANSITIONS = ((0, 10), (10, 100))
SHARED_PATH = "/api/v2/torneos"
CANARY_ONLY_PREFIX = "/api/v4/"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
BOOTSTRAP_ACTIONS = frozenset(
    {"apply", "already-applied", "adoption-required", "incompatible"}
)
SCHEMA_COMPATIBLE_CONFIRMATION = "SCHEMA-COMPATIBLE:sports_db"
CONFIRMED_EXISTING_SCHEMA = f"adoption-required:{SCHEMA_COMPATIBLE_CONFIRMATION}"


@dataclass(frozen=True)
class GateResult:
    decision: str
    reason: str

    @property
    def promotes(self) -> bool:
        return self.decision == "continue"


@dataclass(frozen=True)
class ImageRef:
    track: str
    version: str
    git_sha: str
    digest: str


def parse_digest(value: str, track: str) -> str:
    """Exige un digest remoto. Un Image ID local o el tag latest no sirven."""
    text = value.strip()
    marker = "@sha256:"
    if "latest" in text.split("@")[0].split(":")[-1:]:
        raise ValueError("latest no es una referencia de rollback ni de despliegue")
    if marker not in text:
        raise ValueError("la imagen debe referenciarse por digest @sha256, no por tag ni por Image ID local")
    repository, digest = text.split(marker, 1)
    if not SHA256.fullmatch(digest):
        raise ValueError("el digest sha256 no tiene 64 hexadecimales")
    expected = "sports-api-v3" if track == "stable" else "sports-api-v4"
    if expected not in repository or "docker.pkg.dev/" not in repository:
        raise ValueError(f"el digest de {track} no pertenece a {expected} en Artifact Registry")
    if track == "stable" and "sports-api-v4" in repository:
        raise ValueError("la imagen canary no puede usarse como stable")
    if track == "canary" and repository.rstrip("/").endswith("sports-api-v3"):
        raise ValueError("la imagen stable no puede usarse como canary")
    return text


def provenance(image: ImageRef) -> dict[str, object]:
    if image.version not in {"3.0.2", "4.0.0"}:
        raise ValueError("las versiones de esta entrega son 3.0.2 y 4.0.0")
    if image.track == "stable" and image.version != "3.0.2":
        raise ValueError("stable es 3.0.2")
    if image.track == "canary" and image.version != "4.0.0":
        raise ValueError("canary es 4.0.0")
    if not re.fullmatch(r"[0-9a-f]{40}", image.git_sha):
        raise ValueError("git_sha debe ser el commit completo")
    return {
        "track": image.track,
        "version": image.version,
        "git_sha": image.git_sha,
        "digest": parse_digest(image.digest, image.track),
        "local_image_id_is_registry_digest": False,
    }


def assert_distinct_images(stable: str, canary: str) -> None:
    left = parse_digest(stable, "stable")
    right = parse_digest(canary, "canary")
    if left == right:
        raise ValueError("stable y canary deben ser digests distintos")


def decide_bootstrap(action: str) -> GateResult:
    """El historial de bootstrap no es lo mismo que la compatibilidad del esquema.

    already-applied: el checksum canónico está registrado.
    apply: la base está vacía o el plan pide APPLY; no se despliega.
    adoption-required: hay tablas sin ese historial. ADOPT no se ejecuta.
    adoption-required:SCHEMA-COMPATIBLE:sports_db: el plan ya dijo que el
    esquema coincide y el operador confirma usarlo sin escribir historial.
    incompatible: el esquema no coincide. No se despliega.
    """
    if action in {"adopt", "ADOPT:sports_db"}:
        return GateResult("abort", "ADOPT sigue bloqueado y no escribe historial")
    if action == CONFIRMED_EXISTING_SCHEMA:
        return GateResult(
            "continue",
            "esquema compatible sin historial; no es already-applied, no se ejecuta DDL ni se escribe schema_bootstrap_history",
        )
    if action not in BOOTSTRAP_ACTIONS:
        return GateResult("abort", "accion de bootstrap desconocida")
    if action == "already-applied":
        return GateResult("continue", "historial canónico ya aplicado")
    if action == "apply":
        return GateResult("pause", "base vacía o pendiente: ejecutar APPLY antes de desplegar")
    if action == "adoption-required":
        return GateResult(
            "abort",
            "hay tablas sin historial canónico; ADOPT sigue bloqueado y no autoriza el despliegue",
        )
    return GateResult("abort", "esquema incompatible: el despliegue queda bloqueado")


def parse_bootstrap_output(text: str) -> str:
    actions = []
    for line in text.splitlines():
        if line.startswith("accion="):
            actions.append(line.split("=", 1)[1].strip())
    if len(actions) != 1:
        raise ValueError("la salida de plan debe contener una sola accion")
    return actions[0]


def traffic_step(stable_percent: int, canary_percent: int) -> None:
    pair = (stable_percent, canary_percent)
    if pair not in TRAFFIC_STEPS:
        raise ValueError("el reparto debe ser 100/0, 90/10 o 0/100")
    if stable_percent + canary_percent != 100:
        raise ValueError("los porcentajes deben sumar 100")


def require_revision(name: str, role: str) -> str:
    if name.strip() in {"", "latest", "LATEST"}:
        raise ValueError(f"la revisión {role} tiene que existir y no puede ser latest")
    if not REVISION.fullmatch(name):
        raise ValueError(f"la revisión {role} no tiene un nombre de Cloud Run")
    return name


def verify_split(
    observed: Sequence[Mapping[str, Any]],
    stable_revision: str,
    canary_revision: str,
    stable_percent: int,
    canary_percent: int,
) -> None:
    traffic_step(stable_percent, canary_percent)
    stable_revision = require_revision(stable_revision, "stable")
    canary_revision = require_revision(canary_revision, "canary")
    if stable_revision == canary_revision:
        raise ValueError("stable y canary no pueden ser la misma revisión")
    found: dict[str, int] = {}
    for target in observed:
        revision = str(target.get("revision", ""))
        percent = target.get("percent")
        if revision in {"", "latest", "LATEST"} or not isinstance(percent, int):
            raise ValueError("el tráfico observado debe nombrar revisiones y porcentajes enteros")
        found[revision] = percent
    if found.get(stable_revision) != stable_percent:
        raise ValueError("el porcentaje de stable no coincide")
    if canary_percent == 0 and canary_revision not in found:
        # 0% puede omitirse en la respuesta si la revisión sigue existiendo.
        # La existencia se verifica aparte. Aquí se exige el 100 de stable.
        if sum(found.values()) != 100 or found.get(stable_revision) != 100:
            raise ValueError("sin canary en el tráfico, stable debe quedar al 100")
        return
    if found.get(canary_revision) != canary_percent:
        raise ValueError("el porcentaje de canary no coincide")
    if sum(found.values()) != 100:
        raise ValueError("el tráfico aplicado no suma 100")


def rollback_targets(stable_revision: str, canary_revision: str) -> list[dict[str, object]]:
    stable_revision = require_revision(stable_revision, "stable")
    canary_revision = require_revision(canary_revision, "canary")
    if stable_revision == canary_revision:
        raise ValueError("el rollback no puede apuntar a canary")
    return [
        {"revision": stable_revision, "percent": 100, "tag": "stable"},
        {"revision": canary_revision, "percent": 0, "tag": "canary"},
    ]


def shared_probe_path(path: str) -> str:
    if path.startswith(CANARY_ONLY_PREFIX):
        raise ValueError(
            "una ruta exclusiva de v4 no evalúa stable: el 404 sería esperable"
        )
    if path != SHARED_PATH and not path.startswith("/api/v2/"):
        raise ValueError("la comparación usa rutas compartidas /api/v2")
    return path


def monitoring_filter(project_id: str, revision: str, region: str = "us-central1") -> str:
    require_revision(revision, "medida")
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project_id):
        raise ValueError("project_id no tiene forma de proyecto de GCP")
    # Métricas nativas de Cloud Run. No hay exportador OTEL activo.
    return native_monitoring_filter(
        project_id=project_id,
        region=region,
        revision=revision,
        metric_type=REQUEST_COUNT,
    )


def normalize_metrics(payload: Mapping[str, Any]) -> dict[str, Any]:
    status = str(payload.get("query_status", ""))
    if status not in {"ok", "error", "insufficient", "no_traffic", "not_published"}:
        return {"query_status": "error", "reason": "respuesta de Monitoring no reconocida"}
    if status != "ok":
        return {"query_status": status, "reason": str(payload.get("reason", status))}
    samples = payload.get("samples")
    requests = payload.get("requests")
    errors = payload.get("errors_5xx")
    if not all(isinstance(item, int) and item >= 0 for item in (samples, requests, errors)):
        return {"query_status": "error", "reason": "muestras ilegibles"}
    if requests == 0 or samples < DEMO_MIN_SAMPLES:
        return {"query_status": "insufficient", "samples": samples, "requests": requests}
    return {
        "query_status": "ok",
        "samples": samples,
        "requests": requests,
        "errors_5xx": errors,
        "error_rate": errors / requests,
        "p50_ms": payload.get("p50_ms"),
        "p95_ms": payload.get("p95_ms"),
        "p99_ms": payload.get("p99_ms"),
        "cpu_utilization": payload.get("cpu_utilization"),
        "memory_utilization": payload.get("memory_utilization"),
    }


def _observability_gap(
    reason: str,
    *,
    canary_percent: int,
    waited_seconds: int,
    max_wait_seconds: int,
) -> GateResult:
    if canary_percent > 0 and waited_seconds >= max_wait_seconds:
        return GateResult(
            "abort",
            "falta de observabilidad, no es una regresión comprobada; se restaura stable",
        )
    return GateResult("pause", reason)


def quality_gate(
    canary: Mapping[str, Any],
    stable: Mapping[str, Any],
    *,
    smoke_status: int | None = 200,
    fault_regression: bool = False,
    observation_seconds: int = DEMO_OBSERVATION_SECONDS,
    canary_percent: int = 0,
    waited_seconds: int = 0,
    max_wait_seconds: int = DEMO_MAX_WAIT_SECONDS,
) -> GateResult:
    if fault_regression:
        return GateResult("abort", "regresión provocada por fault injection")
    if smoke_status is None or smoke_status in {401, 403} or smoke_status >= 500 or smoke_status < 200:
        return GateResult("abort", "smoke test fallido")
    if observation_seconds < MIN_OBSERVATION_SECONDS:
        return _observability_gap(
            "una ventana de 60 s no cubre el muestreo ni el retraso de publicación",
            canary_percent=canary_percent,
            waited_seconds=waited_seconds,
            max_wait_seconds=max_wait_seconds,
        )
    current = normalize_metrics(canary)
    baseline = normalize_metrics(stable)
    unreliable = {"error", "insufficient", "no_traffic", "not_published"}
    if current["query_status"] in unreliable or baseline["query_status"] in unreliable:
        reason = "consulta de Monitoring fallida; no se interpreta como cero errores"
        if current["query_status"] != "error" and baseline["query_status"] != "error":
            reason = "datos insuficientes o todavía no publicados; no se promociona"
        return _observability_gap(
            reason,
            canary_percent=canary_percent,
            waited_seconds=waited_seconds,
            max_wait_seconds=max_wait_seconds,
        )
    error_rate = float(current["error_rate"])
    baseline_rate = float(baseline["error_rate"])
    if error_rate > DEMO_MAX_ERROR_RATE or error_rate > baseline_rate + DEMO_MAX_ERROR_DELTA:
        return GateResult("abort", "error rate sobre el umbral de demostración")
    p95 = current.get("p95_ms")
    baseline_p95 = baseline.get("p95_ms")
    if not isinstance(p95, (int, float)) or not isinstance(baseline_p95, (int, float)):
        return _observability_gap(
            "latencia ausente; no se promociona",
            canary_percent=canary_percent,
            waited_seconds=waited_seconds,
            max_wait_seconds=max_wait_seconds,
        )
    if float(p95) > DEMO_MAX_P95_MS or float(p95) > float(baseline_p95) * DEMO_MAX_P95_RATIO:
        return GateResult("abort", "latencia p95 sobre el umbral de demostración")
    return GateResult("continue", "métricas dentro de los umbrales de demostración")


def gcloud_deploy_argv(
    *,
    track: str,
    project_id: str,
    region: str,
    service: str,
    digest: str,
    service_account: str,
    connection_name: str,
    object_storage_url: str,
    database_user: str,
    database_name: str,
    secret_id: str,
    initial: bool = False,
) -> list[str]:
    if service != "sports-demo-api":
        raise ValueError("el canary vive en el servicio único sports-demo-api")
    if track not in {"stable", "canary"}:
        raise ValueError("track inválido")
    if initial and track != "stable":
        raise ValueError("solo la creación inicial de Stable puede recibir tráfico")
    version = "3.0.2" if track == "stable" else "4.0.0"
    image = parse_digest(digest, track)
    env_pairs = [
        f"CLOUD_SQL_CONNECTION_NAME={connection_name}",
        f"DB_USER={database_user}",
        f"DB_NAME={database_name}",
        f"API_VERSION={version}",
        f"API_TRACK={track}",
    ]
    if object_storage_url.strip():
        env_pairs.append(f"OBJECT_STORAGE_API_URL={object_storage_url.strip()}")
    env = ",".join(env_pairs)
    if "FAULT_INJECTION_ENABLED" in env or "DB_HOST=" in env:
        raise ValueError("el despliegue no define DB_HOST ni fault injection")
    command = [
        "gcloud",
        "run",
        "deploy",
        service,
        f"--project={project_id}",
        f"--region={region}",
        f"--image={image}",
    ]
    if not initial:
        command.append("--no-traffic")
    command.extend([
        f"--tag={track}",
        f"--service-account={service_account}",
        "--no-allow-unauthenticated",
        "--clear-cloudsql-instances",
        f"--set-env-vars={env}",
        f"--set-secrets=DB_PASSWORD={secret_id}:latest",
    ])
    return command


def gcloud_traffic_argv(
    *,
    project_id: str,
    region: str,
    service: str,
    stable_revision: str,
    canary_revision: str,
    stable_percent: int,
    canary_percent: int,
) -> list[str]:
    traffic_step(stable_percent, canary_percent)
    stable_revision = require_revision(stable_revision, "stable")
    canary_revision = require_revision(canary_revision, "canary")
    assignment = f"{stable_revision}={stable_percent}"
    if canary_percent > 0:
        assignment = f"{assignment},{canary_revision}={canary_percent}"
    return [
        "gcloud",
        "run",
        "services",
        "update-traffic",
        service,
        f"--project={project_id}",
        f"--region={region}",
        f"--to-revisions={assignment}",
    ]


def load_plan(canary_percent: int, *, min_samples: int = DEMO_MIN_SAMPLES) -> dict[str, object]:
    """Calcula solicitudes a la URL principal. No las envía.

    Al 10 %, 30 solicitudes totales no son 30 muestras de Canary. El plan pide
    suficientes solicitudes para que la porción menor pueda alcanzar el mínimo,
    y las muestras reales se leen después en Monitoring.
    """
    if canary_percent not in {10, 50, 100}:
        raise ValueError("la carga de comparación usa canary al 10, 50 o 100")
    if canary_percent == 100:
        requests = min_samples
        limited_share = 100
    else:
        limited_share = min(canary_percent, 100 - canary_percent)
        requests = math.ceil(min_samples / (limited_share / 100) * 1.5)
    if requests > MAX_DEMO_REQUESTS:
        raise ValueError("la carga supera el tope de 800 solicitudes de la demostración")
    return {
        "path": SHARED_PATH,
        "via": "service-url",
        "requests": requests,
        "concurrency": MAX_DEMO_CONCURRENCY,
        "duration_seconds": MAX_DEMO_DURATION_SECONDS,
        "retries": 1,
        "estimated_share_percent": limited_share,
        "samples_are_measured_by_monitoring": True,
        "sent_requests_are_not_revision_samples": True,
    }


def assert_transition(current_canary_percent: int, target_canary_percent: int) -> None:
    if (current_canary_percent, target_canary_percent) not in PROMOTION_TRANSITIONS:
        raise ValueError("la promoción no puede saltar etapas ni retroceder por este camino")


def promotion_decision(
    *,
    current_canary_percent: int,
    target_canary_percent: int,
    smoke_ok: bool,
    connector_preflight: str,
    canary_metrics: Mapping[str, Any] | None = None,
    stable_metrics: Mapping[str, Any] | None = None,
    observation_seconds: int = DEMO_OBSERVATION_SECONDS,
    waited_seconds: int = 0,
) -> GateResult:
    assert_transition(current_canary_percent, target_canary_percent)
    if connector_preflight != "tables-ok":
        return GateResult("pause", "el preflight del conector todavía no comprobó las tablas de negocio")
    if current_canary_percent == 0:
        if not smoke_ok:
            return GateResult("abort", "no se admite tráfico a canary sin smoke test satisfactorio")
        return GateResult(
            "continue",
            "el 10% inicial se admite por smoke; la ausencia de muestras todavía no es éxito",
        )
    if canary_metrics is None or stable_metrics is None:
        return _observability_gap(
            "faltan las métricas de la etapa actual",
            canary_percent=current_canary_percent,
            waited_seconds=waited_seconds,
            max_wait_seconds=DEMO_MAX_WAIT_SECONDS,
        )
    return quality_gate(
        canary_metrics,
        stable_metrics,
        observation_seconds=observation_seconds,
        canary_percent=current_canary_percent,
        waited_seconds=waited_seconds,
    )


def observed_traffic(service: Mapping[str, Any]) -> list[dict[str, object]]:
    status = service.get("status")
    source = status if isinstance(status, Mapping) else service
    traffic = source.get("traffic", [])
    if not isinstance(traffic, list):
        raise ValueError("el servicio no trae tráfico")
    observed: list[dict[str, object]] = []
    for item in traffic:
        if not isinstance(item, Mapping) or "percent" not in item:
            continue
        revision = str(item.get("revision") or item.get("revisionName") or "")
        observed.append(
            {
                "revision": revision,
                "percent": int(item["percent"]),
                "tag": str(item.get("tag", "")),
            }
        )
    return observed


def _ready_condition_value(item: Mapping[str, Any]) -> str:
    return str(item.get("status") or item.get("state") or "")


def _revision_conditions(revision: Mapping[str, Any]) -> list[Any]:
    conditions = revision.get("conditions")
    if isinstance(conditions, list):
        return conditions
    status = revision.get("status")
    if isinstance(status, Mapping) and isinstance(status.get("conditions"), list):
        return list(status["conditions"])
    return []


def revision_ready(revision: Mapping[str, Any]) -> bool:
    if revision.get("ready") is True:
        return True
    conditions = _revision_conditions(revision)
    return any(
        isinstance(item, Mapping)
        and item.get("type") == "Ready"
        and _ready_condition_value(item) in {"CONDITION_SUCCEEDED", "True"}
        for item in conditions
    )


def revision_wait_state(revision: Mapping[str, Any], *, digest: str, track: str) -> str:
    """ready, pending o failed. Un fallo de digest o de la condición no se reintenta."""
    metadata = revision.get("metadata")
    name = ""
    if isinstance(metadata, Mapping):
        name = str(metadata.get("name", ""))
    require_revision(name or str(revision.get("name", "")), track)
    spec = revision.get("spec") if isinstance(revision.get("spec"), Mapping) else {}
    containers = spec.get("containers") or revision.get("containers") or []
    image = ""
    if isinstance(containers, list) and containers and isinstance(containers[0], Mapping):
        image = str(containers[0].get("image", ""))
    if image != parse_digest(digest, track):
        return "failed"
    if revision_ready(revision):
        return "ready"
    conditions = _revision_conditions(revision)
    if conditions:
        for item in conditions:
            if not isinstance(item, Mapping) or item.get("type") != "Ready":
                continue
            value = _ready_condition_value(item)
            message = str(item.get("message") or "").lower()
            reason = str(item.get("reason") or "").lower()
            if value in {"False", "CONDITION_FAILED"} and (
                "fail" in message or "fail" in reason or reason.endswith("error")
            ):
                return "failed"
    return "pending"


def assert_revisions_ready(
    service: Mapping[str, Any],
    stable_revision: str,
    canary_revision: str,
) -> None:
    stable_revision = require_revision(stable_revision, "stable")
    canary_revision = require_revision(canary_revision, "canary")
    revisions = service.get("revisions", [])
    if not isinstance(revisions, list):
        raise ValueError("el estado no trae revisiones")
    ready = {
        str(item.get("name") or item.get("metadata", {}).get("name"))
        for item in revisions
        if isinstance(item, Mapping) and revision_ready(item)
    }
    if stable_revision not in ready or canary_revision not in ready:
        raise ValueError("una revisión no existe o no está lista; no se cambia el tráfico")


def service_urls(service: Mapping[str, Any]) -> dict[str, str]:
    status = service.get("status") if isinstance(service.get("status"), Mapping) else service
    main = str(status.get("url", ""))
    if not main.startswith("https://"):
        raise ValueError("falta la URL principal del servicio")
    tagged: dict[str, str] = {}
    traffic = status.get("traffic", [])
    if isinstance(traffic, list):
        for raw in traffic:
            if not isinstance(raw, Mapping):
                continue
            tag = str(raw.get("tag", ""))
            url = str(raw.get("url", ""))
            if tag and url.startswith("https://"):
                tagged[tag] = url
    return {"service": main, **tagged}


def monitor_commands(
    *,
    project_id: str,
    region: str,
    revision: str,
    seconds: int,
) -> list[list[str]]:
    chosen = closed_window(seconds)
    return [
        gcloud_monitoring_argv(
            project_id=project_id,
            region=region,
            revision=revision,
            metric_type=metric,
            window=chosen,
        )
        for metric in (REQUEST_COUNT, REQUEST_LATENCIES)
    ]


def parse_monitoring_response(
    payload: Mapping[str, Any] | list[Any],
    *,
    project_id: str,
    region: str,
    revision: str,
    seconds: int,
) -> dict[str, Any]:
    queried = closed_window(seconds)
    body: Mapping[str, Any] | list[Any]
    if isinstance(payload, list):
        body = {"timeSeries": payload}
    else:
        body = payload
    return aggregate_revision(
        body,
        project_id=project_id,
        region=region,
        revision=revision,
        window=queried,
        min_samples=DEMO_MIN_SAMPLES,
    )


def assert_deployed_revision(revision: Mapping[str, Any], *, digest: str, track: str) -> str:
    metadata = revision.get("metadata")
    name = ""
    if isinstance(metadata, Mapping):
        name = str(metadata.get("name", ""))
    name = require_revision(name or str(revision.get("name", "")), track)
    spec = revision.get("spec") if isinstance(revision.get("spec"), Mapping) else {}
    containers = spec.get("containers") or revision.get("containers") or []
    image = ""
    if isinstance(containers, list) and containers and isinstance(containers[0], Mapping):
        image = str(containers[0].get("image", ""))
    if image != parse_digest(digest, track):
        raise ValueError("la revisión creada no usa el digest pedido")
    if not revision_ready(revision):
        raise ValueError("la revisión creada no está lista")
    return name


def gcloud_pin_argv(
    *,
    project_id: str,
    region: str,
    service: str,
    revision: str,
) -> list[str]:
    if service != "sports-demo-api":
        raise ValueError("el canary vive en el servicio único sports-demo-api")
    revision = require_revision(revision, "stable")
    return [
        "gcloud",
        "run",
        "services",
        "update-traffic",
        service,
        f"--project={project_id}",
        f"--region={region}",
        f"--to-revisions={revision}=100",
    ]


def prepare_service(
    describe_payload: Mapping[str, Any],
    revisions: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    if not isinstance(revisions, Sequence) or isinstance(revisions, (str, bytes)):
        raise ValueError("la lista de revisiones no es válida")
    packed = dict(describe_payload)
    packed["revisions"] = list(revisions)
    return packed


def current_canary_percent(service: Mapping[str, Any], canary_revision: str) -> int:
    canary_revision = require_revision(canary_revision, "canary")
    for item in observed_traffic(service):
        if item["revision"] == canary_revision:
            return int(item["percent"])
    return 0


def execute_traffic(argv: Sequence[str], runner: Any) -> bool:
    if "update-traffic" not in argv:
        raise ValueError("solo se ejecuta un cambio de tráfico explícito")
    return int(runner(list(argv))) == 0


def assert_stable_pin(service: Mapping[str, Any], revision: str) -> None:
    revision = require_revision(revision, "stable")
    observed = [item for item in observed_traffic(service) if int(item["percent"]) > 0]
    if len(observed) != 1 or observed[0]["revision"] != revision or int(observed[0]["percent"]) != 100:
        raise ValueError("stable no quedó con el 100 por ciento en la revisión pedida")


def created_revision_name(deploy_response: Mapping[str, Any]) -> str:
    status = deploy_response.get("status")
    source = status if isinstance(status, Mapping) else deploy_response
    return require_revision(str(source.get("latestCreatedRevisionName", "")), "creada")


def assert_observed_split(
    service: Mapping[str, Any],
    *,
    stable_revision: str,
    canary_revision: str,
    stable_percent: int,
    canary_percent: int,
) -> None:
    assert_revisions_ready(service, stable_revision, canary_revision)
    verify_split(
        observed_traffic(service),
        stable_revision,
        canary_revision,
        stable_percent,
        canary_percent,
    )


def decide_and_exit(result: GateResult) -> int:
    print(f"decision={result.decision}")
    print(f"motivo={result.reason}")
    if result.decision == "continue":
        return 0
    if result.decision == "pause":
        return 2
    return 3


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description="Decisiones locales del canary")
    sub = parser.add_subparsers(dest="command", required=True)

    bootstrap = sub.add_parser("bootstrap-gate")
    bootstrap.add_argument("--action")
    bootstrap.add_argument("--plan-output")

    images = sub.add_parser("images")
    images.add_argument("--stable", required=True)
    images.add_argument("--canary", required=True)

    stable_digest = sub.add_parser("stable-digest")
    stable_digest.add_argument("--digest", required=True)

    gate = sub.add_parser("gate")
    gate.add_argument("--canary-metrics", required=True)
    gate.add_argument("--stable-metrics", required=True)
    gate.add_argument("--smoke-status", type=int, default=200)
    gate.add_argument("--fault-regression", action="store_true")
    gate.add_argument("--observation-seconds", type=int, default=DEMO_OBSERVATION_SECONDS)
    gate.add_argument("--canary-percent", type=int, default=0)
    gate.add_argument("--waited-seconds", type=int, default=0)

    monitor = sub.add_parser("monitor-argv")
    monitor.add_argument("--project", required=True)
    monitor.add_argument("--region", required=True)
    monitor.add_argument("--revision", required=True)
    monitor.add_argument("--seconds", type=int, required=True)

    parsed = sub.add_parser("parse-monitoring")
    parsed.add_argument("--raw", required=True)
    parsed.add_argument("--project", required=True)
    parsed.add_argument("--region", required=True)
    parsed.add_argument("--revision", required=True)
    parsed.add_argument("--seconds", type=int, required=True)

    load = sub.add_parser("load-plan")
    load.add_argument("--canary-percent", type=int, required=True)

    promote = sub.add_parser("promote-decision")
    promote.add_argument("--current-canary", type=int, required=True)
    promote.add_argument("--target-canary", type=int, required=True)
    promote.add_argument("--connector-preflight", default="pending")
    promote.add_argument("--smoke-ok", action="store_true")
    promote.add_argument("--canary-metrics")
    promote.add_argument("--stable-metrics")
    promote.add_argument("--observation-seconds", type=int, default=DEMO_OBSERVATION_SECONDS)
    promote.add_argument("--waited-seconds", type=int, default=0)

    check_revision = sub.add_parser("assert-revision")
    check_revision.add_argument("--file", required=True)
    check_revision.add_argument("--digest", required=True)
    check_revision.add_argument("--track", required=True, choices=("stable", "canary"))

    wait_revision = sub.add_parser("revision-wait")
    wait_revision.add_argument("--file", required=True)
    wait_revision.add_argument("--digest", required=True)
    wait_revision.add_argument("--track", required=True, choices=("stable", "canary"))

    check_split = sub.add_parser("assert-split")
    check_split.add_argument("--service", required=True)
    check_split.add_argument("--stable-revision", required=True)
    check_split.add_argument("--canary-revision", required=True)
    check_split.add_argument("--stable-percent", type=int, required=True)
    check_split.add_argument("--canary-percent", type=int, required=True)

    pin = sub.add_parser("pin-argv")
    pin.add_argument("--project", required=True)
    pin.add_argument("--region", required=True)
    pin.add_argument("--revision", required=True)

    pack = sub.add_parser("prepare-service")
    pack.add_argument("--describe", required=True)
    pack.add_argument("--revisions", required=True)
    pack.add_argument("--out", required=True)

    created = sub.add_parser("created-revision")
    created.add_argument("--file", required=True)

    current = sub.add_parser("current-canary")
    current.add_argument("--service", required=True)
    current.add_argument("--canary-revision", required=True)

    pin_check = sub.add_parser("assert-pin")
    pin_check.add_argument("--service", required=True)
    pin_check.add_argument("--revision", required=True)

    traffic = sub.add_parser("traffic-argv")
    traffic.add_argument("--project", required=True)
    traffic.add_argument("--region", required=True)
    traffic.add_argument("--stable-revision", required=True)
    traffic.add_argument("--canary-revision", required=True)
    traffic.add_argument("--stable-percent", type=int, required=True)
    traffic.add_argument("--canary-percent", type=int, required=True)

    rollback = sub.add_parser("rollback-plan")
    rollback.add_argument("--stable-revision", required=True)
    rollback.add_argument("--canary-revision", required=True)
    rollback.add_argument("--reason", required=True)

    deploy = sub.add_parser("deploy-argv")
    deploy.add_argument("--track", required=True, choices=("stable", "canary"))
    deploy.add_argument("--digest", required=True)
    deploy.add_argument("--project", required=True)
    deploy.add_argument("--region", required=True)
    deploy.add_argument("--service-account", required=True)
    deploy.add_argument("--connection-name", required=True)
    deploy.add_argument("--secret", required=True)
    deploy.add_argument("--object-storage-url", default="")
    deploy.add_argument("--initial", action="store_true")

    args = parser.parse_args(list(argv))
    try:
        if args.command == "bootstrap-gate":
            action = args.action
            if args.plan_output:
                action = parse_bootstrap_output(open(args.plan_output, encoding="utf-8").read())
            if not action:
                raise ValueError("falta la accion de bootstrap")
            return decide_and_exit(decide_bootstrap(action))
        if args.command == "images":
            assert_distinct_images(args.stable, args.canary)
            print("images=distinct")
            return 0
        if args.command == "stable-digest":
            print(parse_digest(args.digest, "stable"))
            return 0
        if args.command == "gate":
            canary = json.loads(open(args.canary_metrics, encoding="utf-8").read())
            stable = json.loads(open(args.stable_metrics, encoding="utf-8").read())
            return decide_and_exit(
                quality_gate(
                    canary,
                    stable,
                    smoke_status=args.smoke_status,
                    fault_regression=args.fault_regression,
                    observation_seconds=args.observation_seconds,
                    canary_percent=args.canary_percent,
                    waited_seconds=args.waited_seconds,
                )
            )
        if args.command == "monitor-argv":
            print(json.dumps(monitor_commands(
                project_id=args.project,
                region=args.region,
                revision=args.revision,
                seconds=args.seconds,
            )))
            return 0
        if args.command == "parse-monitoring":
            raw = json.loads(open(args.raw, encoding="utf-8").read())
            print(json.dumps(parse_monitoring_response(
                raw,
                project_id=args.project,
                region=args.region,
                revision=args.revision,
                seconds=args.seconds,
            )))
            return 0
        if args.command == "load-plan":
            print(json.dumps(load_plan(args.canary_percent)))
            return 0
        if args.command == "promote-decision":
            canary_metrics = None
            stable_metrics = None
            if args.canary_metrics:
                canary_metrics = json.loads(open(args.canary_metrics, encoding="utf-8").read())
            if args.stable_metrics:
                stable_metrics = json.loads(open(args.stable_metrics, encoding="utf-8").read())
            return decide_and_exit(promotion_decision(
                current_canary_percent=args.current_canary,
                target_canary_percent=args.target_canary,
                smoke_ok=args.smoke_ok,
                connector_preflight=args.connector_preflight,
                canary_metrics=canary_metrics,
                stable_metrics=stable_metrics,
                observation_seconds=args.observation_seconds,
                waited_seconds=args.waited_seconds,
            ))
        if args.command == "assert-revision":
            revision = json.loads(open(args.file, encoding="utf-8").read())
            print(assert_deployed_revision(revision, digest=args.digest, track=args.track))
            return 0
        if args.command == "revision-wait":
            revision = json.loads(open(args.file, encoding="utf-8").read())
            state = revision_wait_state(revision, digest=args.digest, track=args.track)
            print(f"state={state}")
            if state == "ready":
                return 0
            if state == "pending":
                return 2
            return 1
        if args.command == "assert-split":
            service = json.loads(open(args.service, encoding="utf-8").read())
            assert_observed_split(
                service,
                stable_revision=args.stable_revision,
                canary_revision=args.canary_revision,
                stable_percent=args.stable_percent,
                canary_percent=args.canary_percent,
            )
            print("traffic=verified")
            return 0
        if args.command == "pin-argv":
            print(json.dumps(gcloud_pin_argv(
                project_id=args.project,
                region=args.region,
                service="sports-demo-api",
                revision=args.revision,
            )))
            return 0
        if args.command == "prepare-service":
            describe_payload = json.loads(open(args.describe, encoding="utf-8").read())
            revisions = json.loads(open(args.revisions, encoding="utf-8").read())
            packed = prepare_service(describe_payload, revisions)
            open(args.out, "w", encoding="utf-8").write(json.dumps(packed))
            print("service=packed")
            return 0
        if args.command == "created-revision":
            payload = json.loads(open(args.file, encoding="utf-8").read())
            print(created_revision_name(payload))
            return 0
        if args.command == "current-canary":
            service = json.loads(open(args.service, encoding="utf-8").read())
            print(current_canary_percent(service, args.canary_revision))
            return 0
        if args.command == "assert-pin":
            service = json.loads(open(args.service, encoding="utf-8").read())
            assert_stable_pin(service, args.revision)
            print("pin=verified")
            return 0
        if args.command == "traffic-argv":
            command = gcloud_traffic_argv(
                project_id=args.project,
                region=args.region,
                service="sports-demo-api",
                stable_revision=args.stable_revision,
                canary_revision=args.canary_revision,
                stable_percent=args.stable_percent,
                canary_percent=args.canary_percent,
            )
            print(json.dumps(command))
            return 0
        if args.command == "rollback-plan":
            command = rollback_targets(args.stable_revision, args.canary_revision)
            print(json.dumps({"reason": args.reason, "traffic": command, "delete_revisions": False}))
            return 0
        argv = gcloud_deploy_argv(
            track=args.track,
            project_id=args.project,
            region=args.region,
            service="sports-demo-api",
            digest=args.digest,
            service_account=args.service_account,
            connection_name=args.connection_name,
            object_storage_url=args.object_storage_url,
            database_user="sports_user",
            database_name="sports_db",
            secret_id=args.secret,
            initial=args.initial,
        )
        print(json.dumps(argv))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
