#!/usr/bin/env python3
"""Fixtures con la forma de timeSeries.list. No consulta GCP."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cloud_monitoring import (  # noqa: E402
    INGESTION_DELAY_SECONDS,
    MIN_OBSERVATION_SECONDS,
    REQUEST_COUNT,
    Window,
    aggregate_revision,
    gcloud_monitoring_argv,
    latency_to_milliseconds,
    percentile_from_distribution,
    sum_delta,
    window_from_seconds,
)

PROJECT = "sports-tournaments-multicloud"
REGION = "us-central1"
REVISION = "sports-demo-api-canary"
END = datetime(2026, 11, 6, 18, 0, tzinfo=timezone.utc)


def window(seconds: int = MIN_OBSERVATION_SECONDS, queried_delay: int = INGESTION_DELAY_SECONDS) -> Window:
    return Window(
        start=END - timedelta(seconds=seconds),
        end=END,
        queried_at=END + timedelta(seconds=queried_delay),
    )


def point(start: str, end: str, amount: int) -> dict:
    return {
        "interval": {"startTime": start, "endTime": end},
        "value": {"int64Value": str(amount)},
    }


def count_series(code_class: str, amounts: list[int], *, kind: str = "DELTA", revision: str = REVISION) -> dict:
    points = []
    cursor = END - timedelta(seconds=60 * len(amounts))
    for amount in amounts:
        nxt = cursor + timedelta(seconds=60)
        points.append(
            point(
                cursor.strftime("%Y-%m-%dT%H:%M:%SZ"),
                nxt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                amount,
            )
        )
        cursor = nxt
    return {
        "metric": {
            "type": REQUEST_COUNT,
            "labels": {"response_code_class": code_class},
        },
        "resource": {
            "type": "cloud_run_revision",
            "labels": {
                "project_id": PROJECT,
                "location": REGION,
                "service_name": "sports-demo-api",
                "revision_name": revision,
            },
        },
        "metricKind": kind,
        "valueType": "INT64",
        "points": points,
    }


def latency_series() -> dict:
    return {
        "metric": {"type": "run.googleapis.com/request_latencies", "labels": {}},
        "resource": count_series("2xx", [1])["resource"],
        "metricKind": "DELTA",
        "valueType": "DISTRIBUTION",
        "unit": "s",
        "points": [
            {
                "interval": {
                    "startTime": "2026-11-06T17:57:00Z",
                    "endTime": "2026-11-06T17:58:00Z",
                },
                "value": {
                    "distributionValue": {
                        "count": "10",
                        "mean": 0.4,
                        "bucketOptions": {
                            "exponentialBuckets": {
                                "numFiniteBuckets": 2,
                                "growthFactor": 10,
                                "scale": 0.01,
                            }
                        },
                        "bucketCounts": ["0", "0", "10", "0"],
                    }
                },
            }
        ],
    }


class CloudMonitoringTests(unittest.TestCase):
    def test_delta_points_are_summed_and_cumulative_is_rejected(self) -> None:
        self.assertEqual(sum_delta(count_series("2xx", [10, 20])), 30)
        with self.assertRaises(ValueError):
            sum_delta(count_series("2xx", [10, 30], kind="CUMULATIVE"))

    def test_percentile_uses_the_histogram_in_seconds(self) -> None:
        value = percentile_from_distribution(
            {
                "count": "10",
                "bucketOptions": {
                    "exponentialBuckets": {
                        "numFiniteBuckets": 2,
                        "growthFactor": 10,
                        "scale": 0.01,
                    }
                },
                "bucketCounts": ["0", "0", "10", "0"],
            },
            0.95,
        )
        self.assertAlmostEqual(value or 0, 0.955, places=3)

    def test_aggregate_separates_5xx_and_converts_latency_to_ms(self) -> None:
        payload = {"timeSeries": [count_series("2xx", [15, 15]), count_series("5xx", [2]), latency_series()]}
        result = aggregate_revision(
            payload,
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(),
            min_samples=30,
        )
        self.assertEqual(result["query_status"], "ok")
        self.assertEqual(result["requests"], 32)
        self.assertEqual(result["errors_5xx"], 2)
        self.assertAlmostEqual(result["error_rate"], 2 / 32)
        self.assertAlmostEqual(result["p95_ms"], 955.0, places=1)
        self.assertFalse(result["zero_http_errors"])

    def test_zero_5xx_is_a_real_zero_only_when_requests_exist(self) -> None:
        result = aggregate_revision(
            {"timeSeries": [count_series("2xx", [30]), latency_series()]},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(),
            min_samples=30,
        )
        self.assertEqual(result["errors_5xx"], 0)
        self.assertTrue(result["zero_http_errors"])

    def test_other_revision_is_not_zero_traffic(self) -> None:
        result = aggregate_revision(
            {"timeSeries": [count_series("2xx", [40], revision="sports-demo-api-stable")]},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(),
            min_samples=30,
        )
        self.assertEqual(result["query_status"], "error")
        self.assertNotIn("error_rate", result)

    def test_empty_before_and_after_ingestion_delay(self) -> None:
        early = aggregate_revision(
            {"timeSeries": []},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(queried_delay=30),
            min_samples=30,
        )
        late = aggregate_revision(
            {"timeSeries": []},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(queried_delay=INGESTION_DELAY_SECONDS),
            min_samples=30,
        )
        self.assertEqual(early["query_status"], "not_published")
        self.assertEqual(late["query_status"], "no_traffic")
        self.assertNotEqual(late.get("error_rate"), 0)

    def test_short_window_and_missing_class_do_not_succeed(self) -> None:
        short = aggregate_revision(
            {"timeSeries": []},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(seconds=60, queried_delay=0),
            min_samples=30,
        )
        self.assertEqual(short["query_status"], "not_published")
        unlabeled = count_series("2xx", [40])
        unlabeled["metric"]["labels"] = {}
        result = aggregate_revision(
            {"timeSeries": [unlabeled]},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(),
            min_samples=30,
        )
        self.assertEqual(result["query_status"], "error")

    def test_monitor_command_names_the_revision_and_interval(self) -> None:
        chosen = window()
        argv = gcloud_monitoring_argv(
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            metric_type=REQUEST_COUNT,
            window=chosen,
        )
        rendered = " ".join(argv)
        self.assertIn(f'revision_name="{REVISION}"', rendered)
        self.assertIn(f'location="{REGION}"', rendered)
        self.assertIn("request_count", rendered)
        self.assertNotIn("ALIGN_", rendered)
        self.assertGreaterEqual(chosen.seconds, MIN_OBSERVATION_SECONDS)
        with self.assertRaises(ValueError):
            window_from_seconds(60)

    def test_milliseconds_are_not_scaled_again(self) -> None:
        self.assertEqual(latency_to_milliseconds(1.5, "s"), 1500.0)
        self.assertEqual(latency_to_milliseconds(1500, "ms"), 1500.0)
        measured = latency_series()
        measured["unit"] = "ms"
        result = aggregate_revision(
            {"timeSeries": [count_series("2xx", [30]), measured]},
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(),
            min_samples=30,
        )
        self.assertAlmostEqual(result["p95_ms"], 0.955, places=3)

    def test_duplicate_delta_intervals_are_not_summed(self) -> None:
        payload = {"timeSeries": [count_series("2xx", [30]), count_series("2xx", [30]), latency_series()]}
        result = aggregate_revision(
            payload,
            project_id=PROJECT,
            region=REGION,
            revision=REVISION,
            window=window(),
            min_samples=30,
        )
        self.assertEqual(result["query_status"], "error")
        self.assertNotIn("error_rate", result)


if __name__ == "__main__":
    unittest.main()
