#!/usr/bin/env python3
"""Pruebas locales del canary con respuestas simuladas. No llama a GCP."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canary_rollout import (  # noqa: E402
    DEMO_MIN_SAMPLES,
    assert_distinct_images,
    decide_bootstrap,
    gcloud_deploy_argv,
    gcloud_traffic_argv,
    revision_wait_state,
    monitoring_filter,
    normalize_metrics,
    parse_digest,
    provenance,
    quality_gate,
    rollback_targets,
    shared_probe_path,
    verify_split,
    ImageRef,
)

STABLE = (
    "us-central1-docker.pkg.dev/sports-tournaments-multicloud/"
    "sports-demo-images/sports-api-v3@sha256:"
    + "a" * 64
)
CANARY = (
    "us-central1-docker.pkg.dev/sports-tournaments-multicloud/"
    "sports-demo-images/sports-api-v4@sha256:"
    + "b" * 64
)
SHA = "686b6df70d0e9decf4b1c0d2fc15681b29642da3"


def metrics(errors: int = 0, p95: float = 100, samples: int = 40, status: str = "ok") -> dict:
    return {
        "query_status": status,
        "samples": samples,
        "requests": samples,
        "errors_5xx": errors,
        "p50_ms": 20,
        "p95_ms": p95,
        "p99_ms": p95 + 10,
        "cpu_utilization": 0.2,
        "memory_utilization": 0.3,
    }


class CanaryRolloutTests(unittest.TestCase):
    def test_bootstrap_actions_are_not_schema_compatibility(self) -> None:
        self.assertEqual(decide_bootstrap("already-applied").decision, "continue")
        self.assertEqual(decide_bootstrap("apply").decision, "pause")
        adoption = decide_bootstrap("adoption-required")
        self.assertEqual(adoption.decision, "abort")
        self.assertIn("ADOPT", adoption.reason)
        confirmed = decide_bootstrap(
            "adoption-required:SCHEMA-COMPATIBLE:sports_db",
        )
        self.assertEqual(confirmed.decision, "continue")
        self.assertIn("sin historial", confirmed.reason)
        self.assertNotIn("historial canónico ya aplicado", confirmed.reason)
        self.assertEqual(decide_bootstrap("ADOPT:sports_db").decision, "abort")
        self.assertEqual(decide_bootstrap("incompatible").decision, "abort")

    def test_images_reject_latest_local_ids_and_swapped_tracks(self) -> None:
        parse_digest(STABLE, "stable")
        with self.assertRaises(ValueError):
            parse_digest(STABLE.split("@")[0] + ":latest", "stable")
        with self.assertRaises(ValueError):
            parse_digest("sha256:" + "c" * 64, "stable")
        with self.assertRaises(ValueError):
            parse_digest(CANARY, "stable")
        assert_distinct_images(STABLE, CANARY)
        with self.assertRaises(ValueError):
            assert_distinct_images(STABLE, STABLE)

    def test_provenance_does_not_treat_local_ids_as_digests(self) -> None:
        record = provenance(ImageRef("canary", "4.0.0", SHA, CANARY))
        self.assertFalse(record["local_image_id_is_registry_digest"])
        self.assertEqual(record["git_sha"], SHA)

    def test_shared_route_rejects_v4_only_path(self) -> None:
        self.assertEqual(shared_probe_path("/api/v2/torneos/1"), "/api/v2/torneos/1")
        with self.assertRaises(ValueError):
            shared_probe_path("/api/v4/torneos/1/resumen")

    def test_quality_gate_pause_abort_and_continue(self) -> None:
        self.assertEqual(
            quality_gate(metrics(), metrics()).decision,
            "continue",
        )
        paused = quality_gate(metrics(samples=DEMO_MIN_SAMPLES - 1), metrics())
        self.assertEqual(paused.decision, "pause")
        self.assertFalse(paused.promotes)
        failed = quality_gate({"query_status": "error"}, metrics())
        self.assertEqual(failed.decision, "pause")
        self.assertNotEqual(normalize_metrics({"query_status": "error"}).get("error_rate"), 0)
        self.assertEqual(quality_gate(metrics(errors=10), metrics()).decision, "abort")
        self.assertEqual(quality_gate(metrics(p95=4000), metrics()).decision, "abort")
        self.assertEqual(
            quality_gate(metrics(), metrics(), smoke_status=503).decision,
            "abort",
        )
        self.assertEqual(
            quality_gate(metrics(), metrics(), fault_regression=True).decision,
            "abort",
        )

    def test_rollback_restores_stable_and_keeps_canary_revision(self) -> None:
        targets = rollback_targets("sports-demo-api-stable", "sports-demo-api-canary")
        self.assertEqual(targets[0]["percent"], 100)
        self.assertEqual(targets[1]["percent"], 0)
        verify_split(
            [{"revision": "sports-demo-api-stable", "percent": 100}],
            "sports-demo-api-stable",
            "sports-demo-api-canary",
            100,
            0,
        )
        with self.assertRaises(ValueError):
            rollback_targets("latest", "sports-demo-api-canary")
        with self.assertRaises(ValueError):
            rollback_targets("sports-demo-api-canary", "sports-demo-api-canary")

    def test_traffic_command_is_idempotent_shape_and_names_both_revisions(self) -> None:
        argv = gcloud_traffic_argv(
            project_id="sports-tournaments-multicloud",
            region="us-central1",
            service="sports-demo-api",
            stable_revision="sports-demo-api-stable",
            canary_revision="sports-demo-api-canary",
            stable_percent=90,
            canary_percent=10,
        )
        self.assertIn("--to-revisions=sports-demo-api-stable=90,sports-demo-api-canary=10", argv)
        self.assertNotIn("latest", " ".join(argv))
        with self.assertRaises(ValueError):
            gcloud_traffic_argv(
                project_id="sports-tournaments-multicloud",
                region="us-central1",
                service="sports-demo-api",
                stable_revision="sports-demo-api-stable",
                canary_revision="sports-demo-api-canary",
                stable_percent=80,
                canary_percent=20,
            )

    def test_deploy_argv_stays_private_and_does_not_arm_faults(self) -> None:
        argv = gcloud_deploy_argv(
            track="canary",
            project_id="sports-tournaments-multicloud",
            region="us-central1",
            service="sports-demo-api",
            digest=CANARY,
            service_account="sports-demo-api@sports-tournaments-multicloud.iam.gserviceaccount.com",
            connection_name="sports-tournaments-multicloud:us-central1:sports-demo-mysql",
            object_storage_url="https://storage.example.run.app",
            database_user="sports_user",
            database_name="sports_db",
            secret_id="sports-demo-db-password",
        )
        rendered = " ".join(argv)
        self.assertIn("--no-traffic", argv)
        self.assertIn("--no-allow-unauthenticated", argv)
        self.assertIn("--tag=canary", argv)
        self.assertIn("API_TRACK=canary", rendered)
        self.assertNotIn("FAULT_INJECTION_ENABLED", rendered)
        self.assertNotIn("DB_HOST=", rendered)
        self.assertIn("--set-secrets=DB_PASSWORD=sports-demo-db-password:latest", argv)
        self.assertNotIn("sports_user_password", rendered)
        self.assertIn("sports-api-v4@", rendered)

    def test_initial_stable_deploy_receives_traffic_and_stays_private(self) -> None:
        argv = gcloud_deploy_argv(
            track="stable",
            project_id="sports-tournaments-multicloud",
            region="us-central1",
            service="sports-demo-api",
            digest=STABLE,
            service_account="sports-demo-api@sports-tournaments-multicloud.iam.gserviceaccount.com",
            connection_name="sports-tournaments-multicloud:us-central1:sports-demo-mysql",
            object_storage_url="",
            database_user="sports_user",
            database_name="sports_db",
            secret_id="sports-demo-db-password",
            initial=True,
        )
        rendered = " ".join(argv)
        self.assertNotIn("--no-traffic", argv)
        self.assertIn("--no-allow-unauthenticated", argv)
        self.assertIn("--tag=stable", argv)
        self.assertIn("API_VERSION=3.0.2", rendered)
        self.assertIn("API_TRACK=stable", rendered)
        self.assertIn("sports-api-v3@", rendered)
        self.assertNotIn("FAULT_INJECTION_ENABLED", rendered)
        self.assertNotIn("latest", rendered.split("@sha256:", 1)[0])
        with self.assertRaises(ValueError):
            gcloud_deploy_argv(
                track="canary",
                project_id="sports-tournaments-multicloud",
                region="us-central1",
                service="sports-demo-api",
                digest=CANARY,
                service_account="sports-demo-api@sports-tournaments-multicloud.iam.gserviceaccount.com",
                connection_name="sports-tournaments-multicloud:us-central1:sports-demo-mysql",
                object_storage_url="",
                database_user="sports_user",
                database_name="sports_db",
                secret_id="sports-demo-db-password",
                initial=True,
            )

    def test_gcloud_ready_status_is_not_treated_as_pending(self) -> None:
        ready = {
            "metadata": {"name": "sports-demo-api-00001-paj"},
            "spec": {"containers": [{"image": STABLE}]},
            "status": {"conditions": [{"type": "Ready", "status": "True"}]},
        }
        pending = {
            "metadata": {"name": "sports-demo-api-00001-paj"},
            "spec": {"containers": [{"image": STABLE}]},
            "status": {"conditions": [{"type": "Ready", "status": "Unknown"}]},
        }
        failed = {
            "metadata": {"name": "sports-demo-api-00001-paj"},
            "spec": {"containers": [{"image": STABLE}]},
            "status": {
                "conditions": [{
                    "type": "Ready",
                    "status": "False",
                    "message": "Container failed to start",
                }]
            },
        }
        self.assertEqual(revision_wait_state(ready, digest=STABLE, track="stable"), "ready")
        self.assertEqual(revision_wait_state(pending, digest=STABLE, track="stable"), "pending")
        self.assertEqual(revision_wait_state(failed, digest=STABLE, track="stable"), "failed")
        other = STABLE[:-1] + "b"
        self.assertEqual(revision_wait_state(ready, digest=other, track="stable"), "failed")
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github" / "workflows" / "entrega3-canary.yml").read_text(encoding="utf-8")
        shell = (root / "scripts" / "canary_gcp.sh").read_text(encoding="utf-8")
        self.assertEqual(workflow.count("token_format: access_token"), 1)
        self.assertEqual(workflow.count("token_format: id_token"), 1)
        self.assertIn("create_credentials_file: false", workflow)
        self.assertNotIn("print-identity-token", shell)

    def test_monitoring_filter_uses_native_metric(self) -> None:
        text = monitoring_filter(
            "sports-tournaments-multicloud",
            "sports-demo-api-canary",
        )
        self.assertIn("run.googleapis.com/request_count", text)
        self.assertNotIn("otel", text)

    def test_cli_pause_does_not_exit_zero(self) -> None:
        path = ROOT / "tests" / "_fixture_metrics.json"
        error = ROOT / "tests" / "_fixture_error.json"
        path.write_text(json.dumps(metrics()), encoding="utf-8")
        error.write_text(json.dumps({"query_status": "error"}), encoding="utf-8")
        completed = subprocess.run(
            [
                sys.executable,
                str(ROOT / "canary_rollout.py"),
                "gate",
                "--canary-metrics",
                str(error),
                "--stable-metrics",
                str(path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        path.unlink()
        error.unlink()
        self.assertEqual(completed.returncode, 2)
        self.assertIn("decision=pause", completed.stdout)


if __name__ == "__main__":
    unittest.main()
