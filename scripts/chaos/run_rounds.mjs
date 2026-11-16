#!/usr/bin/env node
/**
 * Procedimiento reproducible Baseline → R0 → R1 (laboratorio local con mocks HTTP).
 * No representa resultados AWS/OCI/GCP.
 *
 * Métrica objetivo bajo latencia inyectada Sports→Hotel:
 * - p95 del recorrido Hotel+Cine
 * - cumplimiento de presupuesto (SLO)
 * - tasa de éxito de negocio
 * - wall-clock de la ronda concurrente (saturación)
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
const HOTEL_TIMEOUT_MS = Number(process.env.HOTEL_TIMEOUT_MS || 300);

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
          await obtenerHabitacion(1, `round-${name}-${i}`);
          await obtenerPelicula(1, `round-${name}-${i}`);
          const ms = performance.now() - t0;
          return { ok: true, ms, errorName: null };
        } catch (error) {
          const ms = performance.now() - t0;
          return { ok: false, ms, errorName: error?.name || "Error" };
        }
      },
    );
    const wallClockMs = performance.now() - wallStart;

    deactivateHotelLatencyFault("end");

    const durations = outcomes.map((o) => o.ms);
    const success = outcomes.filter((o) => o.ok).length;
    const errors = REQUESTS - success;
    const withinSlo = outcomes.filter((o) => o.ms <= SLO_MS).length;
    const errorNames = {};
    for (const o of outcomes) {
      if (o.errorName) {
        errorNames[o.errorName] = (errorNames[o.errorName] || 0) + 1;
      }
    }

    return {
      name,
      resilienceEnabled,
      fault,
      requests: REQUESTS,
      concurrency: CONCURRENCY,
      success,
      errors,
      successRate: success / REQUESTS,
      errorRate: errors / REQUESTS,
      sloMs: SLO_MS,
      withinSloRate: withinSlo / REQUESTS,
      p95Ms: percentile(durations, 95),
      avgMs: durations.reduce((a, b) => a + b, 0) / durations.length,
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

  const p95Improved =
    r1.p95Ms != null && r0.p95Ms != null && r1.p95Ms < r0.p95Ms * 0.7;
  const sloImproved = r1.withinSloRate > r0.withinSloRate + 0.2;
  const wallImproved = r1.wallClockMs < r0.wallClockMs * 0.7;
  const successImproved = r1.successRate > r0.successRate + 0.05;

  let conclusion;
  let diagnosis = null;
  if (successImproved && (p95Improved || sloImproved)) {
    conclusion =
      "Hipótesis SOSTENIDA: R1 mejora éxito de negocio y presupuesto de latencia vs R0.";
  } else if (p95Improved || sloImproved || wallImproved) {
    conclusion =
      "Hipótesis PARCIALMENTE SOSTENIDA: R1 reduce saturación/p95/cumplimiento SLO vs R0, con trade-off en éxitos de negocio (fail-fast).";
    diagnosis = {
      observation:
        "Timeout/CB ante latencia artificial en dependencia SALUDABLE convierte éxitos lentos en errores rápidos.",
      proposedFix:
        "Añadir fallback degradado o reintento idempotente con presupuesto, o limitar el experimento a fallos de Hotel (5xx) donde CB evita cascadas sin sacrificar éxitos sanos.",
    };
  } else {
    conclusion =
      "Hipótesis NO sostenida con estos parámetros. Revisar LATENCY_MS vs HOTEL_TIMEOUT_MS y concurrencia.";
    diagnosis = {
      observation: "R1 no mejoró p95, SLO ni wall-clock frente a R0.",
      proposedFix: "Aumentar latencia inyectada o bajar timeout; verificar activación del interruptor.",
    };
  }

  const report = {
    environment: "local-mocks",
    notMulticloud: true,
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
      "r1 same fault with timeout+CB",
      "compare",
      "final verify fault off",
    ],
    baseline,
    r0,
    r1,
    comparison: {
      p95DeltaPct:
        r0.p95Ms && r1.p95Ms ? ((r1.p95Ms - r0.p95Ms) / r0.p95Ms) * 100 : null,
      successRateDeltaPp: (r1.successRate - r0.successRate) * 100,
      withinSloDeltaPp: (r1.withinSloRate - r0.withinSloRate) * 100,
      wallClockDeltaPct:
        ((r1.wallClockMs - r0.wallClockMs) / r0.wallClockMs) * 100,
      hypothesis:
        "Bajo latencia Sports→Hotel y carga concurrente fija, timeout+CB mejoran el cumplimiento de presupuesto/saturación respecto a R0; se reporta el efecto sobre éxito de negocio.",
      conclusion,
      diagnosis,
    },
    generatedAt: new Date().toISOString(),
  };

  const outDir = resolve(root, "chaos/results");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `rounds-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  // Copia estable para el informe
  writeFileSync(resolve(outDir, "rounds-latest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outFile}`);

  hotel.close();
  cine.close();

  if (!(r0.p95Ms > baseline.p95Ms * 1.5)) {
    console.error("Gate: R0 no degradó claramente el p95 vs baseline");
    process.exit(1);
  }
  if (!(p95Improved || sloImproved || wallImproved)) {
    console.error("Gate: R1 no mejoró p95/SLO/wall vs R0");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
