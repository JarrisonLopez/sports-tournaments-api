/**
 * Perfil fijo k6 — Seguimiento #4 Sports flujo multicloud.
 * El mismo perfil se usa en Baseline, R0 y R1.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const FIXED_STAGES = [
  { duration: "15s", target: 2 },
  { duration: "45s", target: 4 },
  { duration: "15s", target: 0 },
];

const FIXED_THRESHOLDS = {
  http_req_failed: ["rate<0.95"],
  http_req_duration: ["p(95)<15000"],
  flujo_success: ["rate>0.05"],
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

const flujoSuccess = new Rate("flujo_success");
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

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
  });

  flujoSuccess.add(ok);
  flujoDuration.add(res.timings.duration);
  sleep(0.3);
}

export function handleSummary(data) {
  const m = data.metrics || {};
  const payload = {
    runId: RUN_ID,
    round: ROUND,
    generatedAt: new Date().toISOString(),
    profile: {
      stages: FIXED_STAGES,
      thresholds: FIXED_THRESHOLDS,
    },
    metrics: {
      http_req_duration_p95: metricValue(m.http_req_duration, "p(95)"),
      http_req_failed_rate: metricValue(m.http_req_failed, "rate"),
      flujo_success_rate: metricValue(m.flujo_success, "rate"),
      iterations: metricValue(m.iterations, "count"),
      checks_passed: metricValue(m.checks, "passes"),
      checks_failed: metricValue(m.checks, "fails"),
    },
  };

  return {
    stdout: textSummary(data, { indent: " ", enableColors: false }) + "\n" + JSON.stringify(payload, null, 2),
    [`load/results/${ROUND}-${RUN_ID}.json`]: JSON.stringify(payload, null, 2),
  };
}

function metricValue(metric, key) {
  if (!metric) return null;
  if (metric.values && metric.values[key] !== undefined) return metric.values[key];
  if (metric[key] !== undefined) return metric[key];
  return null;
}
