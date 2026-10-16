#!/usr/bin/env python3
"""Pruebas locales del validador de plan Deploy (fixtures JSON sintéticos)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from validate_entrega3_deploy_plan import (  # noqa: E402
    validate_plan,
    validate_plan_file,
)

SPORTS = "module.sports_api[0].google_cloud_run_v2_service.service"
STORAGE = "module.object_storage_service[0].google_cloud_run_v2_service.service"
STORAGE_INVOKER = (
    "module.object_storage_service[0]"
    ".google_cloud_run_v2_service_iam_member.service_invoker[0]"
)


def plan_with(*changes: dict) -> dict:
    return {"format_version": "1.2", "resource_changes": list(changes)}


def change(address: str, actions: list[str]) -> dict:
    return {
        "address": address,
        "change": {
            "actions": actions,
            "before": None if actions == ["create"] else {},
            "after": {} if "delete" not in actions else None,
        },
    }


class ValidateEntrega3DeployPlanTests(unittest.TestCase):
    def test_update_existing_cloud_run_allowed(self) -> None:
        ok, allowed, rejected = validate_plan(
            plan_with(
                change(SPORTS, ["update"]),
                change(STORAGE, ["update"]),
            )
        )
        self.assertTrue(ok)
        self.assertEqual(len(allowed), 2)
        self.assertEqual(rejected, [])

    def test_create_missing_cloud_run_allowed(self) -> None:
        ok, allowed, rejected = validate_plan(
            plan_with(
                change(STORAGE, ["create"]),
                change(STORAGE_INVOKER, ["create"]),
                change(SPORTS, ["create"]),
            )
        )
        self.assertTrue(ok)
        self.assertEqual(len(allowed), 3)
        self.assertEqual(rejected, [])

    def test_create_associated_iam_allowed(self) -> None:
        ok, _, rejected = validate_plan(plan_with(change(STORAGE_INVOKER, ["create"])))
        self.assertTrue(ok)
        self.assertEqual(rejected, [])

    def test_delete_cloud_run_rejected(self) -> None:
        ok, _, rejected = validate_plan(plan_with(change(SPORTS, ["delete"])))
        self.assertFalse(ok)
        self.assertTrue(any("delete is forbidden" in item for item in rejected))

    def test_replace_cloud_run_rejected(self) -> None:
        ok, _, rejected = validate_plan(
            plan_with(change(SPORTS, ["delete", "create"]))
        )
        self.assertFalse(ok)
        self.assertTrue(any("replace" in item for item in rejected))

    def test_unexpected_base_resource_create_rejected(self) -> None:
        ok, _, rejected = validate_plan(
            plan_with(
                change("module.cloud_sql.google_sql_database_instance.main", ["create"])
            )
        )
        self.assertFalse(ok)
        self.assertTrue(any("not on the deploy allowlist" in item for item in rejected))

    def test_unauthorized_update_rejected(self) -> None:
        ok, _, rejected = validate_plan(
            plan_with(
                change(
                    "module.iam.google_service_account.deploy",
                    ["update"],
                )
            )
        )
        self.assertFalse(ok)

    def test_unauthorized_delete_rejected(self) -> None:
        ok, _, rejected = validate_plan(
            plan_with(
                change(
                    "module.secret_manager.google_secret_manager_secret.db_password",
                    ["delete"],
                )
            )
        )
        self.assertFalse(ok)

    def test_unknown_action_rejected(self) -> None:
        ok, _, rejected = validate_plan(plan_with(change(SPORTS, ["read"])))
        self.assertFalse(ok)
        self.assertTrue(any("unsupported actions" in item for item in rejected))

    def test_malformed_plan_rejected(self) -> None:
        ok, _, rejected = validate_plan(["not", "an", "object"])
        self.assertFalse(ok)
        self.assertTrue(rejected)

        ok, _, rejected = validate_plan({"format_version": "1.2"})
        self.assertFalse(ok)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{not-json", encoding="utf-8")
            self.assertEqual(validate_plan_file(path), 2)

    def test_noop_mixed_with_allowed_create(self) -> None:
        ok, allowed, rejected = validate_plan(
            plan_with(
                change("module.cloud_sql.google_sql_database_instance.main", ["no-op"]),
                change(SPORTS, ["create"]),
                change(STORAGE, ["create"]),
                change(STORAGE_INVOKER, ["create"]),
            )
        )
        self.assertTrue(ok)
        self.assertEqual(len(allowed), 3)
        self.assertEqual(rejected, [])

    def test_public_invoker_create_rejected(self) -> None:
        # CI mantiene allow_unauthenticated=false; no abrir allUsers por accidente.
        ok, _, rejected = validate_plan(
            plan_with(
                change(
                    "module.sports_api[0].google_cloud_run_v2_service_iam_member.public_invoker[0]",
                    ["create"],
                )
            )
        )
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
