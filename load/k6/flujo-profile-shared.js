/**
 * Perfil k6 canónico compartible — Seguimiento #4 Sports (Baseline / R0 / R1).
 *
 * Origen: load/k6/flujo-profile.js (mismas intensidades; no inventar parámetros).
 * Compañeros: Samuel (OCI) / Daniel (GCP) — solo cambian BASE_URL e IDs.
 *
 * Stages fijos:
 *   15s → 2 VU
 *   45s → 4 VU
 *   15s → 0 VU
 * Sleep: 0.3 s
 * Thresholds embebidos (soft / runner): http_req_failed rate<0.95; p(95)<15000; flujo_available rate>0.05
 *   → demasiado permisivos para validar hipótesis; no relajar a posteriori.
 * Umbrales a priori de evaluación (post-run): ver docs/seguimiento-4/EXPERIMENTO_HOTEL_503.md
 *
 * Summary JSON registra: full/partial/failed, availability, errorRate, p95, iterations, ROUND, RUN_ID.
 *
 * Ejecución:
 *   BASE_URL=http://3.21.120.51:30080 ROUND=baseline RUN_ID=shared-1 \
 *     k6 run load/k6/flujo-profile-shared.js
 *
 * Docker:
 *   docker run --rm -e BASE_URL=http://3.21.120.51:30080 -e ROUND=baseline -e RUN_ID=shared-1 \
 *     -v "$PWD/load:/scripts" grafana/k6:0.54.0 run /scripts/k6/flujo-profile-shared.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const FIXED_STAGES = [
  { duration: "15s", target: 2 },
  { duration: "45s", target: 4 },
  { duration: "15s", target: 0 },
];

const FIXED_THRESHOLDS = {
  http_req_failed: ["rate<0.95"],
  http_req_duration: ["p(95)<15000"],
  flujo_available: ["rate>0.05"],
};

export const options = {
  scenarios: {
    flujo_fixed: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: FIXED_STAGES,
      gracefulRampDown: "5s",
    },
  },
  thresholds: FIXED_THRESHOLDS,
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

const flujoAvailable = new Rate("flujo_available");
const flujoFull = new Counter("flujo_full");
const flujoPartial = new Counter("flujo_partial");
const flujoFailed = new Counter("flujo_failed");
const flujoDuration = new Trend("flujo_duration_ms", true);

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const TORNEO_ID = __ENV.TORNEO_ID || "1";
const HABITACION_ID = __ENV.HABITACION_ID || "1";
const PELICULA_ID = __ENV.PELICULA_ID || "1";
const RUN_ID = __ENV.RUN_ID || `run-${Date.now()}`;
const ROUND = __ENV.ROUND || "baseline";

export function setup() {
  return {
    runId: RUN_ID,
    round: ROUND,
    profile: {
      stages: FIXED_STAGES,
      thresholds: FIXED_THRESHOLDS,
      endpoint: `${BASE_URL}/api/v2/flujo/${TORNEO_ID}/${HABITACION_ID}/${PELICULA_ID}`,
    },
  };
}

export default function () {
  const traceId = `${RUN_ID}-${ROUND}-${__VU}-${__ITER}`;
  const url = `${BASE_URL}/api/v2/flujo/${TORNEO_ID}/${HABITACION_ID}/${PELICULA_ID}`;

  const res = http.get(url, {
    headers: {
      "x-trace-id": traceId,
      "x-chaos-run-id": RUN_ID,
      "x-chaos-round": ROUND,
    },
    tags: { name: "flujo_multicloud", round: ROUND },
  });

  let kind = "failed";
  let body = null;
  try {
    body = res.json();
  } catch (e) {
    body = null;
  }

  if (res.status === 200 && body && body.habitacion && body.pelicula) {
    const degraded =
      body.status === "partial" ||
      body.degraded === true ||
      (body.habitacion && body.habitacion.origenResiliencia === "fallback");
    kind = degraded ? "partial" : "full";
  }

  check(res, {
    "http 200": (r) => r.status === 200,
    "classified response": () => kind === "full" || kind === "partial" || kind === "failed",
  });

  const available = kind === "full" || kind === "partial";
  flujoAvailable.add(available);
  if (kind === "full") flujoFull.add(1);
  else if (kind === "partial") flujoPartial.add(1);
  else flujoFailed.add(1);

  flujoDuration.add(res.timings.duration);
  sleep(0.3);
}

export function handleSummary(data) {
  const m = data.metrics || {};
  const full = metricValue(m.flujo_full, "count") || 0;
  const partial = metricValue(m.flujo_partial, "count") || 0;
  const failed = metricValue(m.flujo_failed, "count") || 0;
  const total = full + partial + failed;

  const payload = {
    runId: RUN_ID,
    round: ROUND,
    generatedAt: new Date().toISOString(),
    profile: {
      stages: FIXED_STAGES,
      thresholds: FIXED_THRESHOLDS,
    },
    classification: {
      full,
      partial,
      failed,
      total,
      fullSuccessRate: total ? full / total : 0,
      partialRate: total ? partial / total : 0,
      availabilityRate: total ? (full + partial) / total : 0,
      errorRate: total ? failed / total : 0,
    },
    metrics: {
      http_req_duration_p95: metricValue(m.http_req_duration, "p(95)"),
      http_req_failed_rate: metricValue(m.http_req_failed, "rate"),
      flujo_available_rate: metricValue(m.flujo_available, "rate"),
      iterations: metricValue(m.iterations, "count"),
    },
  };

  return {
    stdout:
      textSummary(data, { indent: " ", enableColors: false }) +
      "\n" +
      JSON.stringify(payload, null, 2),
    [`load/results/${ROUND}-${RUN_ID}.json`]: JSON.stringify(payload, null, 2),
  };
}

function metricValue(metric, key) {
  if (!metric) return null;
  if (metric.values && metric.values[key] !== undefined) return metric.values[key];
  if (metric[key] !== undefined) return metric[key];
  return null;
}
