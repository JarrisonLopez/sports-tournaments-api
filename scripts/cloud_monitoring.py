#!/usr/bin/env python3
"""Lectura de métricas nativas de Cloud Run desde la API de Cloud Monitoring.

No abre red. Interpreta el JSON de timeSeries.list. Los contadores DELTA se
suman. Una serie CUMULATIVE no se trata como delta. Una consulta vacía o
fallida no es cero errores.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

SERVICE_NAME = "sports-demo-api"
REQUEST_COUNT = "run.googleapis.com/request_count"
REQUEST_LATENCIES = "run.googleapis.com/request_latencies"
CPU_UTILIZATION = "run.googleapis.com/container/cpu/utilizations"
MEMORY_UTILIZATION = "run.googleapis.com/container/memory/utilizations"

ALIGNMENT_SECONDS = 60
INGESTION_DELAY_SECONDS = 120
MIN_OBSERVATION_SECONDS = ALIGNMENT_SECONDS + INGESTION_DELAY_SECONDS
MAX_METRIC_RETRIES = 3


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime
    queried_at: datetime

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("la ventana de evaluación termina antes de empezar")
        if self.queried_at < self.end:
            raise ValueError("la consulta no puede ocurrir antes del fin de la ventana")

    @property
    def seconds(self) -> float:
        return (self.end - self.start).total_seconds()


def parse_rfc3339(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        raise ValueError("el instante de Monitoring debe incluir zona horaria")
    return parsed.astimezone(timezone.utc)


def closed_window(seconds: int, *, now: datetime | None = None) -> Window:
    """Ventana ya cerrada, con el retraso de publicación fuera del intervalo."""
    if seconds < MIN_OBSERVATION_SECONDS:
        raise ValueError(
            "la ventana debe cubrir el muestreo de 60 s y el retraso de publicación de 120 s"
        )
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    end = current - timedelta(seconds=INGESTION_DELAY_SECONDS)
    return Window(
        start=end - timedelta(seconds=seconds),
        end=end,
        queried_at=current,
    )


def window_from_seconds(
    seconds: int,
    *,
    queried_at: datetime | None = None,
) -> Window:
    if seconds < MIN_OBSERVATION_SECONDS:
        raise ValueError(
            "la ventana debe cubrir el muestreo de 60 s y el retraso de publicación de 120 s"
        )
    end = queried_at or datetime.now(timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return Window(start=end - timedelta(seconds=seconds), end=end, queried_at=end)


def monitoring_filter(
    *,
    project_id: str,
    region: str,
    revision: str,
    metric_type: str,
) -> str:
    if metric_type not in {
        REQUEST_COUNT,
        REQUEST_LATENCIES,
        CPU_UTILIZATION,
        MEMORY_UTILIZATION,
    }:
        raise ValueError("métrica fuera del conjunto nativo de Cloud Run")
    for label, value in (
        ("project_id", project_id),
        ("region", region),
        ("revision", revision),
    ):
        if not value or any(char in value for char in "\"\\"):
            raise ValueError(f"{label} no es seguro para un filtro de Monitoring")
    return (
        'resource.type="cloud_run_revision" '
        f'AND resource.labels.project_id="{project_id}" '
        f'AND resource.labels.location="{region}" '
        f'AND resource.labels.service_name="{SERVICE_NAME}" '
        f'AND resource.labels.revision_name="{revision}" '
        f'AND metric.type="{metric_type}"'
    )


def _labels(series: Mapping[str, Any]) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    resource = series.get("resource")
    metric = series.get("metric")
    if not isinstance(resource, Mapping) or not isinstance(metric, Mapping):
        raise ValueError("la serie no trae resource y metric")
    resource_labels = resource.get("labels")
    metric_labels = metric.get("labels") or {}
    if not isinstance(resource_labels, Mapping) or not isinstance(metric_labels, Mapping):
        raise ValueError("las etiquetas de la serie no son objetos")
    return resource_labels, metric_labels


def _matches(
    series: Mapping[str, Any],
    *,
    project_id: str,
    region: str,
    revision: str,
    metric_type: str,
) -> bool:
    resource_labels, _metric_labels = _labels(series)
    metric = series["metric"]
    return (
        resource_labels.get("project_id") == project_id
        and resource_labels.get("location") == region
        and resource_labels.get("service_name") == SERVICE_NAME
        and resource_labels.get("revision_name") == revision
        and metric.get("type") == metric_type
    )


def _point_value(point: Mapping[str, Any]) -> int:
    value = point.get("value")
    if not isinstance(value, Mapping) or "int64Value" not in value:
        raise ValueError("el contador delta no trae int64Value")
    raw = value["int64Value"]
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        raise ValueError("int64Value ilegible")
    parsed = int(raw)
    if parsed < 0:
        raise ValueError("un delta negativo no se suma")
    return parsed


def _intervals_overlap(points: Sequence[Mapping[str, Any]]) -> bool:
    spans: list[tuple[datetime, datetime]] = []
    for point in points:
        interval = point.get("interval")
        if not isinstance(interval, Mapping):
            raise ValueError("el punto no trae intervalo")
        start = parse_rfc3339(str(interval["startTime"]))
        end = parse_rfc3339(str(interval["endTime"]))
        if end <= start:
            raise ValueError("el intervalo del punto está invertido")
        spans.append((start, end))
    spans.sort()
    for previous, current in zip(spans, spans[1:]):
        if current[0] < previous[1]:
            return True
    return False


def points_inside(series: Mapping[str, Any], window: Window) -> dict[str, Any]:
    points = series.get("points")
    if not isinstance(points, list):
        raise ValueError("la serie no trae points")
    kept = []
    for point in points:
        interval = point.get("interval")
        if not isinstance(interval, Mapping):
            raise ValueError("el punto no trae intervalo")
        start = parse_rfc3339(str(interval["startTime"]))
        end = parse_rfc3339(str(interval["endTime"]))
        if end <= window.start or start >= window.end:
            continue
        if start < window.start or end > window.end:
            raise ValueError("el punto cruza la ventana y no se prorratea")
        kept.append(point)
    clipped = dict(series)
    clipped["points"] = kept
    return clipped


def assert_unique_delta_intervals(series_group: Sequence[Mapping[str, Any]]) -> None:
    """Rechaza la misma etiqueta con intervalos que se pisan entre series."""
    seen: dict[tuple[tuple[str, str], ...], list[tuple[datetime, datetime]]] = {}
    for series in series_group:
        _resource, metric_labels = _labels(series)
        key = tuple(sorted((str(name), str(value)) for name, value in metric_labels.items()))
        intervals = seen.setdefault(key, [])
        points = series.get("points")
        if not isinstance(points, list):
            raise ValueError("la serie no trae points")
        for point in points:
            interval = point.get("interval")
            if not isinstance(interval, Mapping):
                raise ValueError("el punto no trae intervalo")
            start = parse_rfc3339(str(interval["startTime"]))
            end = parse_rfc3339(str(interval["endTime"]))
            for previous_start, previous_end in intervals:
                if start < previous_end and previous_start < end:
                    raise ValueError("los intervalos delta de la misma etiqueta se duplican")
            intervals.append((start, end))


def latency_to_milliseconds(value: float, unit: str) -> float:
    normalized = unit.strip().lower()
    if normalized in {"s", "sec", "secs", "second", "seconds"}:
        return value * 1000.0
    if normalized in {"ms", "msec", "millisecond", "milliseconds"}:
        return value
    raise ValueError("la latencia debe declarar unidad s o ms")


def sum_delta(series: Mapping[str, Any]) -> int:
    kind = str(series.get("metricKind", ""))
    if kind != "DELTA":
        raise ValueError("la serie no es DELTA; no se suman puntos acumulados")
    points = series.get("points")
    if not isinstance(points, list) or not points:
        return 0
    if _intervals_overlap(points):
        raise ValueError("los intervalos delta se solapan y no se suman")
    return sum(_point_value(point) for point in points)


def _bucket_bounds(options: Mapping[str, Any], size: int) -> list[tuple[float, float | None]]:
    exponential = options.get("exponentialBuckets")
    if not isinstance(exponential, Mapping):
        raise ValueError("la distribución no usa buckets exponenciales")
    finite = int(exponential["numFiniteBuckets"])
    growth = float(exponential["growthFactor"])
    scale = float(exponential["scale"])
    if finite < 1 or growth <= 1 or scale <= 0 or size != finite + 2:
        raise ValueError("los buckets exponenciales no cierran con la distribución")
    bounds: list[tuple[float, float | None]] = [(float("-inf"), scale)]
    lower = scale
    for _index in range(finite):
        upper = lower * growth
        bounds.append((lower, upper))
        lower = upper
    bounds.append((lower, None))
    return bounds


def percentile_from_distribution(distribution: Mapping[str, Any], percentile: float) -> float | None:
    if not 0 < percentile <= 1:
        raise ValueError("el percentil debe estar entre 0 y 1")
    count = int(distribution.get("count", "0"))
    if count <= 0:
        return None
    raw_counts = distribution.get("bucketCounts")
    options = distribution.get("bucketOptions")
    if not isinstance(raw_counts, list) or not isinstance(options, Mapping):
        raise ValueError("la distribución no trae histograma")
    counts = [int(item) for item in raw_counts]
    if sum(counts) != count:
        raise ValueError("la suma de buckets no coincide con count")
    bounds = _bucket_bounds(options, len(counts))
    target = percentile * count
    seen = 0
    for count_in_bucket, (lower, upper) in zip(counts, bounds):
        if count_in_bucket == 0:
            continue
        previous = seen
        seen += count_in_bucket
        if seen < target:
            continue
        if upper is None:
            return None
        if lower == float("-inf"):
            return upper
        fraction = (target - previous) / count_in_bucket
        return lower + fraction * (upper - lower)
    return None


def _merge_distributions(parts: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    usable = [part for part in parts if int(part.get("count", "0")) > 0]
    if not usable:
        return None
    first_counts = usable[0]["bucketCounts"]
    merged = [0 for _item in first_counts]
    total = 0
    for part in usable:
        counts = [int(item) for item in part["bucketCounts"]]
        if len(counts) != len(merged):
            raise ValueError("no se pueden sumar histogramas de distinto tamaño")
        total += int(part["count"])
        merged = [left + right for left, right in zip(merged, counts)]
    return {
        "count": str(total),
        "bucketCounts": [str(item) for item in merged],
        "bucketOptions": usable[0]["bucketOptions"],
    }


def aggregate_revision(
    payload: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    *,
    project_id: str,
    region: str,
    revision: str,
    window: Window,
    min_samples: int,
) -> dict[str, Any]:
    """Agrega request_count, latencias y utilización de una revisión."""
    if window.seconds < MIN_OBSERVATION_SECONDS:
        return {
            "query_status": "not_published",
            "reason": "la ventana es menor que el retraso de Cloud Monitoring",
        }
    series_list: list[Mapping[str, Any]]
    if isinstance(payload, Mapping):
        if payload.get("query_status") == "error":
            return {"query_status": "error", "reason": str(payload.get("reason", "consulta fallida"))}
        raw_series = payload.get("timeSeries", [])
        if not isinstance(raw_series, list):
            return {"query_status": "error", "reason": "timeSeries no es una lista"}
        series_list = raw_series
    else:
        series_list = list(payload)

    matched: list[Mapping[str, Any]] = []
    foreign = 0
    for series in series_list:
        try:
            resource_labels, _metric_labels = _labels(series)
        except ValueError as exc:
            return {"query_status": "error", "reason": str(exc)}
        metric_type = str(series.get("metric", {}).get("type", ""))
        if _matches(
            series,
            project_id=project_id,
            region=region,
            revision=revision,
            metric_type=metric_type,
        ):
            matched.append(series)
        elif resource_labels.get("revision_name") not in {None, revision}:
            foreign += 1
        else:
            foreign += 1
    if foreign and not matched:
        return {
            "query_status": "error",
            "reason": "la respuesta trae otra revisión o etiquetas ajenas",
        }

    published_after = window.end + timedelta(seconds=INGESTION_DELAY_SECONDS)
    if not matched:
        if window.queried_at < published_after:
            return {
                "query_status": "not_published",
                "reason": "Monitoring todavía puede no haber publicado el muestreo de 60 s",
            }
        return {
            "query_status": "no_traffic",
            "requests": 0,
            "errors_5xx": 0,
            "reason": "no hubo series de la revisión después del retraso de publicación",
        }

    requests = 0
    errors = 0
    distributions: list[Mapping[str, Any]] = []
    latency_unit = ""
    try:
        counted = [
            points_inside(series, window)
            for series in matched
            if str(series.get("metric", {}).get("type", "")) == REQUEST_COUNT
        ]
        assert_unique_delta_intervals(counted)
        for series in matched:
            series = points_inside(series, window)
            metric_type = str(series["metric"]["type"])
            if metric_type == REQUEST_COUNT:
                _resource, metric_labels = _labels(series)
                code_class = str(metric_labels.get("response_code_class", ""))
                if code_class not in {"1xx", "2xx", "3xx", "4xx", "5xx"}:
                    return {
                        "query_status": "error",
                        "reason": "request_count sin response_code_class no se cuenta como éxito",
                    }
                amount = sum_delta(series)
                requests += amount
                if code_class == "5xx":
                    errors += amount
            elif metric_type == REQUEST_LATENCIES:
                if str(series.get("metricKind", "")) != "DELTA":
                    return {"query_status": "error", "reason": "la latencia no es DELTA"}
                unit = str(series.get("unit", ""))
                if not unit:
                    return {"query_status": "error", "reason": "la latencia no declara unidad"}
                if latency_unit and latency_unit != unit:
                    return {"query_status": "error", "reason": "las series de latencia mezclan unidades"}
                latency_unit = unit
                for point in series.get("points", []):
                    value = point.get("value", {})
                    distribution = value.get("distributionValue")
                    if isinstance(distribution, Mapping):
                        distributions.append(distribution)
    except (KeyError, TypeError, ValueError) as exc:
        return {"query_status": "error", "reason": str(exc)}

    if requests < min_samples:
        return {
            "query_status": "insufficient",
            "requests": requests,
            "errors_5xx": errors,
            "samples": requests,
            "reason": "las solicitudes medidas no alcanzan el mínimo",
        }

    merged = None
    try:
        merged = _merge_distributions(distributions)
        p50 = None if merged is None else percentile_from_distribution(merged, 0.50)
        p95 = None if merged is None else percentile_from_distribution(merged, 0.95)
        p99 = None if merged is None else percentile_from_distribution(merged, 0.99)
    except (KeyError, TypeError, ValueError) as exc:
        return {"query_status": "error", "reason": str(exc)}

    def millis(value: float | None) -> float | None:
        if value is None:
            return None
        if not latency_unit:
            return None
        return latency_to_milliseconds(value, latency_unit)

    return {
        "query_status": "ok",
        "requests": requests,
        "samples": requests,
        "errors_5xx": errors,
        "error_rate": errors / requests,
        "p50_ms": millis(p50),
        "p95_ms": millis(p95),
        "p99_ms": millis(p99),
        "zero_http_errors": errors == 0,
    }


def gcloud_monitoring_argv(
    *,
    project_id: str,
    region: str,
    revision: str,
    metric_type: str,
    window: Window,
) -> list[str]:
    return [
        "gcloud",
        "monitoring",
        "time-series",
        "list",
        f"--project={project_id}",
        f"--filter={monitoring_filter(project_id=project_id, region=region, revision=revision, metric_type=metric_type)}",
        f"--interval-start-time={window.start.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"--interval-end-time={window.end.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        "--format=json",
    ]

