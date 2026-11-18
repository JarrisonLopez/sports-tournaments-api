/**
 * Perfil moderado k6 — validación AWS (no altera umbrales de CI).
 * Clasifica full | partial | failed.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const FIXED_STAGES = [
  { duration: "20s", target: 2 },
  { duration: "40s", target: 4 },
  { duration: "15s", target: 0 },
];

export const options = {
  scenarios: {
    aws_moderate: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: FIXED_STAGES,
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.95"],
    http_req_duration: ["p(95)<15000"],
    flujo_available: ["rate>0.05"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

const flujoAvailable = new Rate("flujo_available");
const flujoFull = new Counter("flujo_full");
const flujoPartial = new Counter("flujo_partial");
const flujoFailed = new Counter("flujo_failed");
const flujoDuration = new Trend("flujo_duration_ms", true);

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:30080").replace(/\/+$/, "");
const TORNEO_ID = __ENV.TORNEO_ID || "1";
const HABITACION_ID = __ENV.HABITACION_ID || "1";
const PELICULA_ID = __ENV.PELICULA_ID || "1";
const RUN_ID = __ENV.RUN_ID || `aws-${Date.now()}`;

export default function () {
  const url = `${BASE_URL}/api/v2/flujo/${TORNEO_ID}/${HABITACION_ID}/${PELICULA_ID}`;
  const res = http.get(url, {
    headers: {
      "x-trace-id": `${RUN_ID}-${__VU}-${__ITER}`,
      "x-chaos-run-id": RUN_ID,
      "x-chaos-round": "aws-validate",
    },
    tags: { name: "flujo_aws" },
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
    "classified": () => kind === "full" || kind === "partial" || kind === "failed",
  });

  const available = kind === "full" || kind === "partial";
  flujoAvailable.add(available);
  if (kind === "full") flujoFull.add(1);
  else if (kind === "partial") flujoPartial.add(1);
  else flujoFailed.add(1);
  flujoDuration.add(res.timings.duration);
  sleep(0.4);
}

export function handleSummary(data) {
  const m = data.metrics || {};
  const full = (m.flujo_full && m.flujo_full.values && m.flujo_full.values.count) || 0;
  const partial = (m.flujo_partial && m.flujo_partial.values && m.flujo_partial.values.count) || 0;
  const failed = (m.flujo_failed && m.flujo_failed.values && m.flujo_failed.values.count) || 0;
  const total = full + partial + failed;
  const payload = {
    environment: "aws-k3s",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    classification: {
      full,
      partial,
      failed,
      total,
      fullSuccessRate: total ? full / total : 0,
      partialRate: total ? partial / total : 0,
      availabilityRate: total ? (full + partial) / total : 0,
    },
    metrics: {
      http_req_duration_p95: m.http_req_duration && m.http_req_duration.values && m.http_req_duration.values["p(95)"],
      http_req_failed_rate: m.http_req_failed && m.http_req_failed.values && m.http_req_failed.values.rate,
    },
  };
  return {
    stdout: textSummary(data, { indent: " ", enableColors: false }) + "\n" + JSON.stringify(payload, null, 2),
    [`load/results/aws-validate-${RUN_ID}.json`]: JSON.stringify(payload, null, 2),
  };
}
