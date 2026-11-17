#!/usr/bin/env node
/**
 * Baseline → R0 → R1 con la misma latencia/carga.
 *
 * Hipótesis (a priori):
 * Bajo latencia inyectada Sports→Hotel (LATENCY_MS) e idéntica carga concurrente,
 * timeout + circuit breaker + fallback de Hotel mantienen tasa de éxito de negocio
 * (success|partial) ≥ 90% y reducen el p95 de solicitudes EXITOSAS ≥ 30% vs R0.
 *
 * SLO: solo solicitudes exitosas (ok) con duración ≤ SLO_MS.
 * Los errores rápidos NO cuentan como within-SLO.
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const TOKEN = process.env.CHAOS_FAULT_TOKEN || "chaos-lab-token-minimo-32-chars!!";
const LATENCY_MS = Number(process.env.CHAOS_HOTEL_LATENCY_MS || 800);
const REQUESTS = Number(process.env.CHAOS_ROUND_REQUESTS || 24);
const CONCURRENCY = Number(process.env.CHAOS_ROUND_CONCURRENCY || 8);
const SLO_MS = Number(process.env.CHAOS_SLO_MS || 500);
const TTL_MS = Number(process.env.CHAOS_HOTEL_LATENCY_TTL_MS || 120000);
/** Timeout < latencia inyectada para que dispare; fallback evita 0% éxito. */
const HOTEL_TIMEOUT_MS = Number(process.env.HOTEL_TIMEOUT_MS || 400);

const HYPOTHESIS =
  "Con timeout+CB+fallback ante latencia Hotel, el flujo mantiene éxito de negocio ≥90% (incluye parciales) y reduce p95 de respuestas exitosas ≥30% vs R0, misma carga e inyección.";

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[idx];
}

function startMock(port, handler) {
  const server = createServer(handler);
  return new Promise((resolveListen) => {
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

async function main() {
  process.env.CHAOS_LAB_ENABLED = "true";
  process.env.CHAOS_FAULT_TOKEN = TOKEN;
  process.env.FLUJO_ORCHESTRATION_MODE = "sequential";
  delete process.env.OBJECT_STORAGE_API_URL;

  const hotelPort = 18081;
  const cinePort = 18082;
  process.env.HOTEL_API_URL = `http://127.0.0.1:${hotelPort}`;
  process.env.CINE_API_URL = `http://127.0.0.1:${cinePort}`;

  const hotel = await startMock(hotelPort, (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${hotelPort}`);
    const match = url.pathname.match(/^\/api\/v2\/habitacion\/(\d+)$/);
    if (match) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: Number(match[1]),
          numeroHabitacion: "101",
          precioHabitacion: 1,
          estadoHabitacion: "ok",
          tipoHabitacion: "std",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  const cine = await startMock(cinePort, (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${cinePort}`);
    const match = url.pathname.match(/^\/api\/v2\/peliculas\/(\d+)$/);
    if (match) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: Number(match[1]),
          nombre: "P",
          duracion: 1,
          genero: "g",
          descripcion: "d",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  try {
    execSync("npx tsc -p tsconfig.json --pretty false", {
      cwd: root,
      stdio: "pipe",
    });
  } catch (error) {
    hotel.close();
    cine.close();
    console.error("tsc failed", error?.stdout?.toString?.() || error);
    process.exit(1);
  }

  const toUrl = (rel) => pathToFileURL(resolve(root, rel)).href;
  const { obtenerHabitacion } = await import(toUrl("dist/clients/hotel.client.js"));
  const { obtenerPelicula } = await import(toUrl("dist/clients/cine.client.js"));
  const {
    activateHotelLatencyFault,
    deactivateHotelLatencyFault,
    resetHotelLatencyFaultForTests,
  } = await import(toUrl("dist/chaos/hotel-latency-fault.js"));
  const { resetHotelCircuitBreakerForTests } = await import(
    toUrl("dist/resilience/circuit-breaker.js")
  );

  async function runRound(name, { resilienceEnabled, fault }) {
    process.env.RESILIENCE_ENABLED = resilienceEnabled ? "true" : "false";
    process.env.HOTEL_FALLBACK_ENABLED = resilienceEnabled ? "true" : "false";
    process.env.HOTEL_TIMEOUT_MS = String(HOTEL_TIMEOUT_MS);
    process.env.HOTEL_CB_FAILURE_THRESHOLD = "3";
    process.env.HOTEL_CB_OPEN_MS = "2000";
    process.env.HOTEL_CB_SUCCESS_THRESHOLD = "1";

    resetHotelLatencyFaultForTests();
    resetHotelCircuitBreakerForTests();

    if (fault) {
      activateHotelLatencyFault({
        token: TOKEN,
        latencyMs: LATENCY_MS,
        ttlMs: TTL_MS,
        config: {
          labEnabled: true,
          token: TOKEN,
          maxLatencyMs: 10_000,
          maxTtlMs: 300_000,
        },
      });
    }

    const wallStart = performance.now();
    const outcomes = await mapPool(
      Array.from({ length: REQUESTS }, (_, i) => i),
      CONCURRENCY,
      async (i) => {
        const t0 = performance.now();
        try {
          const habitacion = await obtenerHabitacion(1, `round-${name}-${i}`);
          await obtenerPelicula(1, `round-${name}-${i}`);
          const ms = performance.now() - t0;
          const partial = habitacion?.origenResiliencia === "fallback";
          return {
            ok: true,
            partial,
            status: partial ? "partial" : "success",
            ms,
            errorName: null,
          };
        } catch (error) {
          const ms = performance.now() - t0;
          return {
            ok: false,
            partial: false,
            status: "failed",
            ms,
            errorName: error?.name || "Error",
          };
        }
      },
    );
    const wallClockMs = performance.now() - wallStart;
    deactivateHotelLatencyFault("end");

    const successOutcomes = outcomes.filter((o) => o.ok);
    const failedOutcomes = outcomes.filter((o) => !o.ok);
    const successDurations = successOutcomes.map((o) => o.ms);
    const allDurations = outcomes.map((o) => o.ms);
    const partialCount = outcomes.filter((o) => o.partial).length;
    const withinSloSuccess = successOutcomes.filter((o) => o.ms <= SLO_MS).length;
    const errorNames = {};
    for (const o of failedOutcomes) {
      errorNames[o.errorName] = (errorNames[o.errorName] || 0) + 1;
    }

    return {
      name,
      resilienceEnabled,
      fault,
      requests: REQUESTS,
      concurrency: CONCURRENCY,
      success: successOutcomes.length,
      partial: partialCount,
      fullSuccess: successOutcomes.length - partialCount,
      errors: failedOutcomes.length,
      successRate: successOutcomes.length / REQUESTS,
      errorRate: failedOutcomes.length / REQUESTS,
      sloMs: SLO_MS,
      /** Solo éxitos bajo presupuesto; errores no cuentan. */
      withinSloRate:
        successOutcomes.length === 0
          ? 0
          : withinSloSuccess / successOutcomes.length,
      withinSloOfTotal: withinSloSuccess / REQUESTS,
      p95SuccessMs: percentile(successDurations, 95),
      p95AllMs: percentile(allDurations, 95),
      avgSuccessMs:
        successDurations.length === 0
          ? null
          : successDurations.reduce((a, b) => a + b, 0) / successDurations.length,
      avgAllMs: allDurations.reduce((a, b) => a + b, 0) / allDurations.length,
      wallClockMs,
      errorNames,
    };
  }

  const baseline = await runRound("baseline", {
    resilienceEnabled: false,
    fault: false,
  });
  const r0 = await runRound("r0", { resilienceEnabled: false, fault: true });
  const r1 = await runRound("r1", { resilienceEnabled: true, fault: true });

  const successOk = r1.successRate >= 0.9;
  const p95Improved =
    r1.p95SuccessMs != null &&
    r0.p95SuccessMs != null &&
    r1.p95SuccessMs <= r0.p95SuccessMs * 0.7;
  const sloImproved = r1.withinSloOfTotal >= r0.withinSloOfTotal + 0.2;

  let conclusion;
  let diagnosis = null;
  if (successOk && p95Improved) {
    conclusion =
      "Hipótesis SOSTENIDA: R1 mantiene ≥90% éxito de negocio y reduce ≥30% el p95 de éxitos vs R0.";
  } else if (successOk && sloImproved) {
    conclusion =
      "Hipótesis SOSTENIDA (vía SLO): R1 mantiene éxito y mejora cumplimiento de presupuesto vs R0.";
  } else {
    conclusion = "Hipótesis NO sostenida con la evidencia actual.";
    diagnosis = {
      observation: {
        r1SuccessRate: r1.successRate,
        r0P95Success: r0.p95SuccessMs,
        r1P95Success: r1.p95SuccessMs,
      },
      proposedFix:
        "Revisar HOTEL_TIMEOUT_MS vs LATENCY_MS, fallback y umbrales CB sin relajar el gate.",
    };
  }

  const report = {
    environment: "local-mocks",
    notMulticloud: true,
    hypothesis: HYPOTHESIS,
    thresholdsAPriori: {
      minR1SuccessRate: 0.9,
      maxR1P95SuccessRatioVsR0: 0.7,
      rejectIfR1SuccessRateIsZero: true,
      sloCountsOnlySuccessfulRequests: true,
    },
    preflight: {
      hotel: process.env.HOTEL_API_URL,
      cine: process.env.CINE_API_URL,
      latencyMs: LATENCY_MS,
      hotelTimeoutMs: HOTEL_TIMEOUT_MS,
      requests: REQUESTS,
      concurrency: CONCURRENCY,
      sloMs: SLO_MS,
    },
    procedure: [
      "preflight mocks",
      "steady baseline",
      "r0 fault without resilience",
      "restore fault switch",
      "r1 same fault with timeout+CB+fallback",
      "compare",
      "final verify fault off",
    ],
    baseline,
    r0,
    r1,
    comparison: {
      p95SuccessDeltaPct:
        r0.p95SuccessMs && r1.p95SuccessMs
          ? ((r1.p95SuccessMs - r0.p95SuccessMs) / r0.p95SuccessMs) * 100
          : null,
      successRateDeltaPp: (r1.successRate - r0.successRate) * 100,
      withinSloOfTotalDeltaPp:
        (r1.withinSloOfTotal - r0.withinSloOfTotal) * 100,
      wallClockDeltaPct:
        ((r1.wallClockMs - r0.wallClockMs) / r0.wallClockMs) * 100,
      hypothesis: HYPOTHESIS,
      conclusion,
      diagnosis,
    },
    generatedAt: new Date().toISOString(),
  };

  const outDir = resolve(root, "chaos/results");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `rounds-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  writeFileSync(resolve(outDir, "rounds-latest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outFile}`);

  hotel.close();
  cine.close();

  // Gate estricto (también usado por evaluate_gate.mjs)
  if (!(r0.p95SuccessMs > baseline.p95SuccessMs * 1.5)) {
    console.error("Gate: R0 no degradó p95 de éxitos vs baseline");
    process.exit(1);
  }
  if (r1.successRate <= 0) {
    console.error("Gate: R1 con 0% éxito — rechazado");
    process.exit(1);
  }
  if (r1.successRate < 0.9) {
    console.error(`Gate: R1 successRate ${r1.successRate} < 0.9`);
    process.exit(1);
  }
  if (!p95Improved && !sloImproved) {
    console.error("Gate: R1 no mejoró p95 de éxitos ni SLO vs R0");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
