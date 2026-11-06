#!/usr/bin/env python3
"""Decisiones locales del canary de sports-demo-api.

No llama a gcloud, Cloud Monitoring ni Cloud SQL. Los comandos de despliegue
se construyen como listas de argumentos para que un workflow autorizado los
ejecute después. Un fallo de métricas no es cero errores y no promociona.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

# Umbrales de demostración académica. No son SLO calibrados en producción.
DEMO_MIN_SAMPLES = 30
DEMO_MAX_ERROR_RATE = 0.05
DEMO_MAX_ERROR_DELTA = 0.02
DEMO_MAX_P95_MS = 1500.0
DEMO_MAX_P95_RATIO = 2.0
DEMO_OBSERVATION_SECONDS = 60

TRAFFIC_STEPS = ((100, 0), (90, 10), (50, 50), (0, 100))
SHARED_PATH = "/api/v2/torneos/1"
CANARY_ONLY_PREFIX = "/api/v4/"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
BOOTSTRAP_ACTIONS = frozenset(
    {"apply", "already-applied", "adoption-required", "incompatible"}
)


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
    adoption-required: hay tablas sin ese historial. No se ejecuta ADOPT.
    incompatible: el esquema no coincide. No se despliega.
    """
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
        raise ValueError("el reparto debe ser 100/0, 90/10, 50/50 o 0/100")
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


def monitoring_filter(project_id: str, revision: str) -> str:
    require_revision(revision, "medida")
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project_id):
        raise ValueError("project_id no tiene forma de proyecto de GCP")
    # Métricas nativas de Cloud Run. No hay exportador OTEL activo:
    # otel_exporter_otlp_endpoint está vacío y estas series no salen del código.
    return (
        'resource.type="cloud_run_revision" '
        f'AND resource.labels.project_id="{project_id}" '
        'AND resource.labels.service_name="sports-demo-api" '
        f'AND resource.labels.revision_name="{revision}" '
        'AND metric.type="run.googleapis.com/request_count"'
    )


def normalize_metrics(payload: Mapping[str, Any]) -> dict[str, Any]:
    status = str(payload.get("query_status", ""))
    if status not in {"ok", "error", "insufficient"}:
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


def quality_gate(
    canary: Mapping[str, Any],
    stable: Mapping[str, Any],
    *,
    smoke_status: int | None = 200,
    fault_regression: bool = False,
) -> GateResult:
    if fault_regression:
        return GateResult("abort", "regresión provocada por fault injection")
    if smoke_status is None or smoke_status >= 500 or smoke_status < 100:
        return GateResult("abort", "smoke test fallido")
    current = normalize_metrics(canary)
    baseline = normalize_metrics(stable)
    if current["query_status"] == "error" or baseline["query_status"] == "error":
        return GateResult("pause", "consulta de Monitoring fallida; no se interpreta como cero errores")
    if current["query_status"] != "ok" or baseline["query_status"] != "ok":
        return GateResult("pause", "datos insuficientes; no se promociona por ausencia de métricas")
    error_rate = float(current["error_rate"])
    baseline_rate = float(baseline["error_rate"])
    if error_rate > DEMO_MAX_ERROR_RATE or error_rate > baseline_rate + DEMO_MAX_ERROR_DELTA:
        return GateResult("abort", "error rate sobre el umbral de demostración")
    p95 = current.get("p95_ms")
    baseline_p95 = baseline.get("p95_ms")
    if not isinstance(p95, (int, float)) or not isinstance(baseline_p95, (int, float)):
        return GateResult("pause", "latencia ausente; no se promociona")
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
) -> list[str]:
    if service != "sports-demo-api":
        raise ValueError("el canary vive en el servicio único sports-demo-api")
    if track not in {"stable", "canary"}:
        raise ValueError("track inválido")
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
    return [
        "gcloud",
        "run",
        "deploy",
        service,
        f"--project={project_id}",
        f"--region={region}",
        f"--image={image}",
        "--no-traffic",
        f"--tag={track}",
        f"--service-account={service_account}",
        "--no-allow-unauthenticated",
        "--clear-cloudsql-instances",
        f"--set-env-vars={env}",
        f"--set-secrets=DB_PASSWORD={secret_id}:latest",
    ]


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
                )
            )
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
        )
        print(json.dumps(argv))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
