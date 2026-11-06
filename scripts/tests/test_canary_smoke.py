#!/usr/bin/env python3
"""Smoke, audiencia y preflight del conector. No abre red."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from canary_smoke import (  # noqa: E402
    BUSINESS_MARKER,
    CANARY_V4_PATH,
    classify_response,
    connector_preflight,
    smoke_call,
)

TOKEN = "ya29.token-que-no-puede-imprimirse"


class SmokeTests(unittest.TestCase):
    def test_audience_is_the_service_url_and_the_request_is_tagged(self) -> None:
        plan = smoke_call(
            service_url="https://sports-demo-api.example.run.app",
            tagged_url="https://canary---sports-demo-api.example.run.app",
            path="/api/v2/torneos",
            track="canary",
            version="4.0.0",
        )
        rendered = json.dumps(plan)
        self.assertEqual(plan["audience"], "https://sports-demo-api.example.run.app")
        self.assertIn("/api/v2/torneos", str(plan["request_url"]))
        self.assertNotEqual(plan["audience"], plan["request_url"])
        self.assertNotIn(TOKEN, rendered)
        self.assertNotIn("ya29.", rendered)

    def test_v4_is_rejected_for_stable(self) -> None:
        with self.assertRaises(ValueError):
            smoke_call(
                service_url="https://sports-demo-api.example.run.app",
                tagged_url="https://stable---sports-demo-api.example.run.app",
                path=CANARY_V4_PATH,
                track="stable",
                version="3.0.2",
            )

    def test_auth_errors_and_wrong_revision_stop(self) -> None:
        for status in (401, 403):
            result = classify_response(
                status,
                {"x-api-track": "canary", "x-api-version": "4.0.0"},
                expected_track="canary",
                expected_version="4.0.0",
            )
            self.assertEqual(result["decision"], "abort")
        mismatch = classify_response(
            200,
            {"x-api-track": "stable", "x-api-version": "3.0.2"},
            expected_track="canary",
            expected_version="4.0.0",
        )
        self.assertEqual(mismatch["decision"], "abort")

    def test_ready_without_business_tables_is_not_a_preflight(self) -> None:
        only_ready = connector_preflight("Base de datos conectada", 200)
        self.assertEqual(only_ready["status"], "failed")
        proved = connector_preflight(BUSINESS_MARKER, 200)
        self.assertEqual(proved["status"], "tables-ok")
        missing = connector_preflight("Falta la tabla requerida: torneos", 200)
        self.assertEqual(missing["status"], "failed")


if __name__ == "__main__":
    unittest.main()
