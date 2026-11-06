#!/usr/bin/env python3
"""Ejecuta argv JSON de gcloud solo cuando el workflow ya confirmó la operación."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any


def authorized() -> bool:
    return os.environ.get("CANARY_GCP_EXECUTION") == "authorized"


def load_commands(path: str) -> list[list[str]]:
    payload: Any = json.loads(open(path, encoding="utf-8").read())
    if payload and isinstance(payload[0], str):
        return [list(payload)]
    if not isinstance(payload, list) or not all(isinstance(item, list) for item in payload):
        raise ValueError("el archivo no contiene argv de gcloud")
    return [list(item) for item in payload]


def reject_image_latest(argv: list[str]) -> None:
    for item in argv:
        if item in {"latest", "LATEST"}:
            raise ValueError("latest no selecciona una imagen ni una revisión")
        if item.startswith("--image=") and "@sha256:" not in item:
            raise ValueError("la imagen debe ir por digest")
        if item.startswith("--to-revisions=") and "latest" in item.lower():
            raise ValueError("el tráfico no puede apuntar a latest")


def main(argv: list[str]) -> int:
    if len(argv) not in {1, 2}:
        print("uso: run_json_argv.py ARGV.json [SALIDA.json]", file=sys.stderr)
        return 1
    if not authorized():
        print(
            "bloqueo: ejecución GCP no autorizada en este proceso",
            file=sys.stderr,
        )
        return 1
    commands = load_commands(argv[0])
    series: list[Any] = []
    for command in commands:
        reject_image_latest(command)
        if command[:3] == ["gcloud", "run", "deploy"]:
            command = [*command, "--format=json"]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            if command[1:3] == ["monitoring", "time-series"]:
                print(json.dumps({
                    "query_status": "error",
                    "reason": "gcloud monitoring failed",
                }))
                return 0
            sys.stderr.write("gcloud terminó sin éxito\n")
            return completed.returncode
        if command[:4] == ["gcloud", "monitoring", "time-series", "list"]:
            parsed = json.loads(completed.stdout or "[]")
            if isinstance(parsed, dict) and isinstance(parsed.get("timeSeries"), list):
                series.extend(parsed["timeSeries"])
            elif isinstance(parsed, list):
                series.extend(parsed)
            else:
                print(json.dumps({
                    "query_status": "error",
                    "reason": "respuesta de Monitoring ilegible",
                }))
                return 0
        elif len(argv) == 2:
            open(argv[1], "w", encoding="utf-8").write(completed.stdout)
        else:
            sys.stdout.write(completed.stdout)
    if commands and commands[0][:4] == ["gcloud", "monitoring", "time-series", "list"]:
        print(json.dumps({"timeSeries": series}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
