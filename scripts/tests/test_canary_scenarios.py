#!/usr/bin/env python3
"""Recorridos de promoción y rollback con plataformas simuladas. No llama a GCP."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canary_rollout import (  # noqa: E402
    assert_revisions_ready,
    execute_traffic,
    gcloud_deploy_argv,
    gcloud_traffic_argv,
    load_plan,
    promotion_decision,
    quality_gate,
    rollback_targets,
    verify_split,
)
from run_json_argv import reject_image_latest  # noqa: E402

STABLE = "sports-demo-api-stable"
CANARY = "sports-demo-api-canary"
DIGEST = (
    "us-central1-docker.pkg.dev/sports-tournaments-multicloud/"
    "sports-demo-images/sports-api-v4@sha256:"
    + "b" * 64
)


def measured(errors: int = 0, p95: float = 200) -> dict:
    return {
        "query_status": "ok",
        "samples": 40,
        "requests": 40,
        "errors_5xx": errors,
        "error_rate": errors / 40,
        "p50_ms": 80,
        "p95_ms": p95,
        "p99_ms": 400,
    }


def observed(stable_percent: int, canary_percent: int) -> list[dict]:
    rows = [{"revision": STABLE, "percent": stable_percent, "tag": "stable"}]
    if canary_percent > 0 or stable_percent == 0:
        rows.append({"revision": CANARY, "percent": canary_percent, "tag": "canary"})
    return rows


class ScenarioTests(unittest.TestCase):
    def test_successful_promotion_uses_measured_samples(self) -> None:
        plan = load_plan(10)
        self.assertGreaterEqual(int(plan["requests"]), 375)
        self.assertNotEqual(plan["requests"], 30)
        self.assertTrue(plan["samples_are_measured_by_monitoring"])
        state = (100, 0)
        applied: list[tuple[int, int]] = [state]
        for stable_percent, canary_percent in ((90, 10), (50, 50), (0, 100)):
            current = state[1]
            metrics = None if current == 0 else measured()
            decision = promotion_decision(
                current_canary_percent=current,
                target_canary_percent=canary_percent,
                smoke_ok=True,
                connector_preflight="tables-ok",
                canary_metrics=metrics,
                stable_metrics=None if current == 0 else measured(),
            )
            self.assertEqual(decision.decision, "continue", decision.reason)
            argv = gcloud_traffic_argv(
                project_id="sports-tournaments-multicloud",
                region="us-central1",
                service="sports-demo-api",
                stable_revision=STABLE,
                canary_revision=CANARY,
                stable_percent=stable_percent,
                canary_percent=canary_percent,
            )
            self.assertTrue(execute_traffic(argv, lambda _command: 0))
            verify_split(observed(stable_percent, canary_percent), STABLE, CANARY, stable_percent, canary_percent)
            state = (stable_percent, canary_percent)
            applied.append(state)
        self.assertEqual(applied, [(100, 0), (90, 10), (50, 50), (0, 100)])

    def test_regression_rolls_back_to_named_stable(self) -> None:
        decision = promotion_decision(
            current_canary_percent=10,
            target_canary_percent=50,
            smoke_ok=True,
            connector_preflight="tables-ok",
            canary_metrics=measured(errors=10),
            stable_metrics=measured(),
        )
        self.assertEqual(decision.decision, "abort")
        argv = gcloud_traffic_argv(
            project_id="sports-tournaments-multicloud",
            region="us-central1",
            service="sports-demo-api",
            stable_revision=STABLE,
            canary_revision=CANARY,
            stable_percent=100,
            canary_percent=0,
        )
        self.assertTrue(execute_traffic(argv, lambda _command: 0))
        verify_split(observed(100, 0), STABLE, CANARY, 100, 0)
        restored = rollback_targets(STABLE, CANARY)
        self.assertEqual(restored[0]["percent"], 100)
        self.assertEqual(restored[1]["percent"], 0)
        self.assertNotIn("latest", " ".join(argv))

    def test_failed_rollback_is_not_reported_as_restored(self) -> None:
        argv = gcloud_traffic_argv(
            project_id="sports-tournaments-multicloud",
            region="us-central1",
            service="sports-demo-api",
            stable_revision=STABLE,
            canary_revision=CANARY,
            stable_percent=100,
            canary_percent=0,
        )
        self.assertFalse(execute_traffic(argv, lambda _command: 1))

    def test_missing_metrics_do_not_promote_and_time_out_as_observability(self) -> None:
        paused = quality_gate(
            {"query_status": "not_published"},
            {"query_status": "no_traffic"},
            canary_percent=10,
            waited_seconds=0,
        )
        self.assertEqual(paused.decision, "pause")
        self.assertNotIn("error_rate", paused.reason)
        expired = quality_gate(
            {"query_status": "error", "reason": "gcloud monitoring failed"},
            {"query_status": "ok", "samples": 40, "requests": 40, "errors_5xx": 0, "p95_ms": 100},
            canary_percent=10,
            waited_seconds=600,
        )
        self.assertEqual(expired.decision, "abort")
        self.assertIn("falta de observabilidad", expired.reason)
        short = quality_gate(measured(), measured(), observation_seconds=60, canary_percent=0)
        self.assertEqual(short.decision, "pause")

    def test_missing_revision_bad_split_and_secret_latest(self) -> None:
        with self.assertRaises(ValueError):
            assert_revisions_ready({"revisions": [{"name": STABLE, "ready": True}]}, STABLE, CANARY)
        with self.assertRaises(ValueError):
            verify_split(observed(80, 20), STABLE, CANARY, 80, 20)
        argv = gcloud_deploy_argv(
            track="canary",
            project_id="sports-tournaments-multicloud",
            region="us-central1",
            service="sports-demo-api",
            digest=DIGEST,
            service_account="sports-demo-api@sports-tournaments-multicloud.iam.gserviceaccount.com",
            connection_name="sports-tournaments-multicloud:us-central1:sports-demo-mysql",
            object_storage_url="",
            database_user="sports_user",
            database_name="sports_db",
            secret_id="sports-demo-db-password",
        )
        reject_image_latest(argv)
        blocked = subprocess.run(
            [sys.executable, str(ROOT / "run_json_argv.py"), "missing.json"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(blocked.returncode, 1)
        self.assertIn("no autorizada", blocked.stderr)

    def test_workflow_does_not_invent_metric_samples(self) -> None:
        workflow = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "entrega3-canary.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertNotIn("el workflow no inventa muestras", text)
        self.assertNotIn('{"query_status":"error"', text)
        self.assertIn("CANARY_GCP_EXECUTION", text)


if __name__ == "__main__":
    unittest.main()
