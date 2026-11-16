/**
 * Perfil fijo k6 — Seguimiento #4 Sports flujo multicloud.
 * El mismo perfil se usa en Baseline, R0 y R1 (no cambiar VUs/duration/thresholds entre rondas).
 *
 * Variables de entorno:
 *   BASE_URL          default http://127.0.0.1:8080
 *   TORNEO_ID         default 1
 *   HABITACION_ID     default 1
 *   PELICULA_ID       default 1
 *   RUN_ID            identificador de ejecución
 *   ROUND             baseline|r0|r1
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

export const options = {
  scenarios: {
    flujo_fixed: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 2 },
        { duration: "45s", target: 4 },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.30"],
    http_req_duration: ["p(95)<8000"],
    flujo_success: ["rate>0.50"],
  },
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
      stages: options.scenarios.flujo_fixed.stages,
      thresholds: options.thresholds,
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
  const payload = {
    runId: RUN_ID,
    round: ROUND,
    generatedAt: new Date().toISOString(),
    metrics: {
      http_req_duration_p95:
        data.metrics.http_req_duration?.values?.["p(95)"] ?? null,
      http_req_failed_rate: data.metrics.http_req_failed?.values?.rate ?? null,
      flujo_success_rate: data.metrics.flujo_success?.values?.rate ?? null,
      iterations: data.metrics.iterations?.values?.count ?? null,
    },
    raw: {
      root_group: data.root_group,
      metrics: Object.fromEntries(
        Object.entries(data.metrics).map(([k, v]) => [k, v.values]),
      ),
    },
  };

  return {
    stdout: JSON.stringify(payload, null, 2),
    [`load/results/${ROUND}-${RUN_ID}.json`]: JSON.stringify(payload, null, 2),
  };
}
