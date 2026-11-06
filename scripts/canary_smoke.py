#!/usr/bin/env python3
"""Smoke tests y preflight del conector. No abre red ni imprime tokens."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Mapping, Sequence

BUSINESS_MARKER = "Esquema de negocio comprobado"
SHARED_PATH = "/api/v2/torneos"
CANARY_V4_PATH = "/api/v4/torneos/estadisticas"


def smoke_call(
    *,
    service_url: str,
    tagged_url: str,
    path: str,
    track: str,
    version: str,
) -> dict[str, object]:
    if track not in {"stable", "canary"}:
        raise ValueError("el track del smoke es stable o canary")
    if path.startswith("/api/v4/") and track != "canary":
        raise ValueError("v4 solo se prueba contra la URL etiquetada de canary")
    if not service_url.startswith("https://") or not tagged_url.startswith("https://"):
        raise ValueError("las URLs del smoke deben ser https")
    if service_url.rstrip("/") == tagged_url.rstrip("/"):
        raise ValueError("la audiencia es la URL principal y la petición va a la URL etiquetada")
    request = {
        "request_url": tagged_url.rstrip("/") + path,
        "audience": service_url,
        "expected_headers": {
            "x-api-track": track,
            "x-api-version": version,
        },
        "authorization": "redacted",
    }
    rendered = json.dumps(request)
    if "Bearer " in rendered or "ya29." in rendered:
        raise ValueError("el plan de smoke no puede contener un token")
    return request


def classify_response(
    status: int,
    headers: Mapping[str, str],
    *,
    expected_track: str,
    expected_version: str,
) -> dict[str, str]:
    normalized = {key.lower(): value for key, value in headers.items()}
    if status in {401, 403}:
        return {"decision": "abort", "reason": "401/403 detiene la validación"}
    if status >= 500 or status < 200 or status >= 300:
        return {"decision": "abort", "reason": "el smoke no recibió 200"}
    if normalized.get("x-api-track") != expected_track:
        return {"decision": "abort", "reason": "la cabecera x-api-track no identifica la revisión"}
    if normalized.get("x-api-version") != expected_version:
        return {"decision": "abort", "reason": "la cabecera x-api-version no identifica la revisión"}
    return {"decision": "continue", "reason": "smoke de la revisión etiquetada"}


def connector_preflight(log_text: str, ready_status: int) -> dict[str, str]:
    if ready_status != 200:
        return {"status": "failed", "reason": "ready no respondió 200"}
    if "Falta la tabla" in log_text:
        return {"status": "failed", "reason": "falta una tabla de negocio"}
    if BUSINESS_MARKER not in log_text:
        return {
            "status": "failed",
            "reason": "SELECT 1 no demuestra las tablas de negocio",
        }
    return {
        "status": "tables-ok",
        "reason": "la revisión comprobó torneos, canchas y jugadores antes de escuchar",
    }


def header_value(text: str, name: str) -> str:
    prefix = name.lower() + ":"
    for line in text.splitlines():
        if line.lower().startswith(prefix):
            return line.split(":", 1)[1].strip()
    return ""


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description="Smoke local del canary")
    sub = parser.add_subparsers(dest="command", required=True)
    preflight = sub.add_parser("preflight")
    preflight.add_argument("--log", required=True)
    preflight.add_argument("--ready-status", type=int, required=True)
    check = sub.add_parser("classify")
    check.add_argument("--status", type=int, required=True)
    check.add_argument("--track", required=True)
    check.add_argument("--version", required=True)
    check.add_argument("--header-file", required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("--service", required=True)
    plan.add_argument("--track", required=True, choices=("stable", "canary"))
    plan.add_argument("--path", required=True)
    args = parser.parse_args(list(argv))
    if args.command == "preflight":
        result = connector_preflight(open(args.log, encoding="utf-8").read(), args.ready_status)
        print(f"status={result['status']}")
        print(f"motivo={result['reason']}")
        return 0 if result["status"] == "tables-ok" else 1
    if args.command == "plan":
        from canary_rollout import service_urls

        service = json.loads(open(args.service, encoding="utf-8").read())
        urls = service_urls(service)
        version = "3.0.2" if args.track == "stable" else "4.0.0"
        planned = smoke_call(
            service_url=urls["service"],
            tagged_url=urls[args.track],
            path=args.path,
            track=args.track,
            version=version,
        )
        print(f"request_url={planned['request_url']}")
        print(f"audience={planned['audience']}")
        return 0
    headers = open(args.header_file, encoding="utf-8").read()
    result = classify_response(
        args.status,
        {
            "x-api-track": header_value(headers, "x-api-track"),
            "x-api-version": header_value(headers, "x-api-version"),
        },
        expected_track=args.track,
        expected_version=args.version,
    )
    print(f"decision={result['decision']}")
    print(f"motivo={result['reason']}")
    return 0 if result["decision"] == "continue" else 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
