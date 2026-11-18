#!/usr/bin/env node
/**
 * Validación final local R0/R1 ante Hotel HTTP 503 (sin OCI).
 * Arranca lab/flujo-lab-hotel503.mjs, prueba curls y opcionalmente deja el puerto listo.
 *
 *   node scripts/chaos/validate_hotel503_final.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const port = Number(process.env.SPORTS_LAB_PORT || 18080);
const base = `http://127.0.0.1:${port}`;
const token = process.env.CHAOS_FAULT_TOKEN || "chaos-lab-token-minimo-32-chars!!";
const evidence = resolve(
  root,
  "docs/seguimiento-4/evidence/aws-hotel503/final-local-validation",
);
mkdirSync(evidence, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/lab/ready`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error("lab not ready");
}

async function setMode(resilience, fallback) {
  const res = await fetch(`${base}/lab/resilience`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chaos-token": token,
    },
    body: JSON.stringify({
      resilienceEnabled: resilience,
      hotelFallbackEnabled: fallback,
      hotelTimeoutMs: 2000,
    }),
  });
  if (!res.ok) throw new Error(`setMode ${res.status}`);
  return res.json();
}

async function callFlujo(traceId) {
  const res = await fetch(`${base}/api/v2/flujo/1/1/1`, {
    headers: { "x-trace-id": traceId },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function classify(status, body) {
  if (status === 200 && body && body.habitacion && body.pelicula) {
    const degraded =
      body.status === "partial" ||
      body.degraded === true ||
      body.habitacion?.origenResiliencia === "fallback";
    return degraded ? "partial" : "full";
  }
  return "failed";
}

const lab = spawn("node", ["lab/flujo-lab-hotel503.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    SPORTS_LAB_PORT: String(port),
    HOTEL_MOCK_PORT: "18081",
    CINE_MOCK_PORT: "18082",
    RESILIENCE_ENABLED: "false",
    HOTEL_FALLBACK_ENABLED: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let labOut = "";
lab.stdout.on("data", (d) => {
  labOut += d.toString();
});
lab.stderr.on("data", (d) => {
  labOut += d.toString();
});

const report = {
  generatedAt: new Date().toISOString(),
  base,
  cases: [],
  r1Sample: null,
  conclusion: "BLOQUEADO",
};

try {
  await waitReady();
  writeFileSync(resolve(evidence, "lab-boot.txt"), labOut || "ready");

  // R0
  await setMode(false, false);
  const r0 = await callFlujo("final-r0-503");
  const r0Kind = classify(r0.status, r0.body);
  const r0Ok =
    r0Kind === "failed" &&
    r0.status >= 500 &&
    (r0.body?.message || r0.body?.error || true);
  report.cases.push({
    round: "R0",
    httpStatus: r0.status,
    kind: r0Kind,
    ok: r0Ok,
    bodyKeys: r0.body ? Object.keys(r0.body) : [],
  });
  writeFileSync(
    resolve(evidence, "r0-response.json"),
    JSON.stringify(r0, null, 2),
  );

  // R1
  await setMode(true, true);
  const r1 = await callFlujo("final-r1-503");
  const r1Kind = classify(r1.status, r1.body);
  const h = r1.body?.habitacion || {};
  const r1Ok =
    r1Kind === "partial" &&
    r1.status === 200 &&
    r1.body?.status === "partial" &&
    r1.body?.degraded === true &&
    h.origenResiliencia === "fallback" &&
    typeof h.numeroHabitacion === "string" &&
    h.numeroHabitacion.startsWith("DEG-") &&
    r1.body?.pelicula?.id === 1 &&
    r1.body?.providers?.hotel?.via === "fallback";
  report.r1Sample = {
    httpStatus: r1.status,
    status: r1.body?.status,
    degraded: r1.body?.degraded,
    degradedDependencies: r1.body?.degradedDependencies,
    habitacion: {
      id: h.id,
      numeroHabitacion: h.numeroHabitacion,
      precioHabitacion: h.precioHabitacion,
      estadoHabitacion: h.estadoHabitacion,
      tipoHabitacion: h.tipoHabitacion,
      origenResiliencia: h.origenResiliencia,
    },
    pelicula: {
      id: r1.body?.pelicula?.id,
      nombre: r1.body?.pelicula?.nombre,
    },
    providers: {
      hotel: r1.body?.providers?.hotel,
      cine: {
        origen: r1.body?.providers?.cine?.origen,
        // omit baseUrl lab detail noise if needed
        baseUrl: r1.body?.providers?.cine?.baseUrl,
      },
    },
  };
  report.cases.push({
    round: "R1",
    httpStatus: r1.status,
    kind: r1Kind,
    ok: r1Ok,
  });
  writeFileSync(
    resolve(evidence, "r1-response.json"),
    JSON.stringify(report.r1Sample, null, 2),
  );

  const allOk = report.cases.every((c) => c.ok);
  report.conclusion = allOk ? "LISTO_PARA_K6" : "BLOQUEADO";
  writeFileSync(resolve(evidence, "curl-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!allOk) {
    lab.kill("SIGTERM");
    process.exit(1);
  }

  // Keep lab up for k6 if KEEP_LAB=1
  if (process.env.KEEP_LAB === "1") {
    console.log(`LAB_UP ${base}`);
    await new Promise(() => {});
  } else {
    lab.kill("SIGTERM");
  }
} catch (err) {
  console.error(err);
  writeFileSync(resolve(evidence, "error.txt"), String(err?.stack || err));
  lab.kill("SIGTERM");
  process.exit(1);
}
