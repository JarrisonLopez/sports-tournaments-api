#!/usr/bin/env python3
"""Valida el plan Terraform del workflow Entrega 3 GCP Deploy.

Permite redespliegue (update) y primer Deploy tras Provision (create de Cloud Run
+ IAM invoker de Object Storage). Rechaza delete/replace y cualquier otro recurso.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# Servicios Cloud Run gestionados con count = deploy_applications ? 1 : 0
ALLOWED_SERVICE_ADDRESSES = frozenset(
    {
        "module.sports_api[0].google_cloud_run_v2_service.service",
        "module.object_storage_service[0].google_cloud_run_v2_service.service",
    }
)

# En el primer Deploy, Object Storage concede run.invoker a la SA de Sports.
# public_invoker no se incluye: CI mantiene allow_unauthenticated = false.
ALLOWED_CREATE_ADDRESSES = ALLOWED_SERVICE_ADDRESSES | frozenset(
    {
        "module.object_storage_service[0].google_cloud_run_v2_service_iam_member.service_invoker[0]",
    }
)

ALLOWED_UPDATE_ADDRESSES = ALLOWED_SERVICE_ADDRESSES


def _normalize_actions(actions: list[Any]) -> list[str]:
    return [str(item) for item in actions]


def classify_change(address: str, actions: list[str]) -> str | None:
    """Devuelve None si el cambio es admisible; si no, un motivo de rechazo."""
    if not actions or actions == ["no-op"]:
        return None

    # replace / create+delete
    if "delete" in actions and "create" in actions:
        return "replace (create+delete) is forbidden"

    if actions == ["delete"] or ("delete" in actions and "create" not in actions):
        return "delete is forbidden"

    if actions == ["create"]:
        if address in ALLOWED_CREATE_ADDRESSES:
            return None
        return "create is not on the deploy allowlist"

    if actions == ["update"]:
        if address in ALLOWED_UPDATE_ADDRESSES:
            return None
        return "update is not on the deploy allowlist"

    return f"unsupported actions: {','.join(actions)}"


def validate_plan(plan: Any) -> tuple[bool, list[str], list[str]]:
    """Valida un documento terraform show -json.

    Returns:
        (ok, allowed_summaries, rejected_summaries)
    """
    if not isinstance(plan, dict):
        return False, [], ["plan root must be a JSON object"]

    if "resource_changes" not in plan:
        return False, [], ["plan is missing resource_changes"]

    resource_changes = plan.get("resource_changes")
    if resource_changes is None:
        return False, [], ["resource_changes must not be null"]
    if not isinstance(resource_changes, list):
        return False, [], ["resource_changes must be a list"]

    allowed: list[str] = []
    rejected: list[str] = []

    for index, change in enumerate(resource_changes):
        if not isinstance(change, dict):
            rejected.append(f"resource_changes[{index}]: entry must be an object")
            continue

        address = change.get("address")
        if not isinstance(address, str) or not address.strip():
            rejected.append(f"resource_changes[{index}]: missing address")
            continue

        change_body = change.get("change")
        if not isinstance(change_body, dict):
            rejected.append(f"{address}: missing change object")
            continue

        raw_actions = change_body.get("actions")
        if not isinstance(raw_actions, list):
            rejected.append(f"{address}: missing actions list")
            continue

        actions = _normalize_actions(raw_actions)
        reason = classify_change(address, actions)
        summary = f"{address}: {','.join(actions) or '<none>'}"
        if reason is None:
            if actions and actions != ["no-op"]:
                allowed.append(summary)
            continue
        rejected.append(f"{summary} ({reason})")

    return len(rejected) == 0, allowed, rejected


def validate_plan_file(path: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"Cannot read plan JSON: {exc}", file=sys.stderr)
        return 2

    try:
        plan = json.loads(text)
    except json.JSONDecodeError as exc:
        print(f"Malformed plan JSON: {exc}", file=sys.stderr)
        return 2

    ok, allowed, rejected = validate_plan(plan)

    if allowed:
        print("Allowed deploy plan changes:")
        for item in allowed:
            print(f"  - {item}")

    if rejected:
        print("Rejected Terraform plan changes:", file=sys.stderr)
        for item in rejected:
            print(f"  - {item}", file=sys.stderr)
        print(
            "Deploy allows no-op; update of the two Cloud Run services; "
            "create of those services and Object Storage service_invoker IAM only.",
            file=sys.stderr,
        )
        return 1

    print("Plan validation passed for Entrega 3 Deploy.")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            f"Usage: {argv[0]} <tfplan.json>",
            file=sys.stderr,
        )
        return 2
    return validate_plan_file(Path(argv[1]))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
