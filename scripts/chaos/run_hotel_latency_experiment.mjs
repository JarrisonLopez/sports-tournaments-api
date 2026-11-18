#!/usr/bin/env node
/**
 * Runner declarativo del experimento de latencia (compatible Windows).
 * Lee la intención de chaos/experiments/hotel-latency.yaml y ejecuta
 * steady-state → activate → hold → rollback → verify.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const baseUrl = (process.env.SPORTS_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);
const token = process.env.CHAOS_FAULT_TOKEN || "";
const latencyMs = Number(process.env.CHAOS_HOTEL_LATENCY_MS || 2000);
const ttlMs = Number(process.env.CHAOS_HOTEL_LATENCY_TTL_MS || 90000);
const holdSeconds = Number(process.env.CHAOS_HOLD_SECONDS || 5);

function loadExperimentMeta() {
  const yamlPath = resolve(root, "chaos/experiments/hotel-latency.yaml");
  const text = readFileSync(yamlPath, "utf8");
  const title = text.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? "hotel-latency";
  return { title, yamlPath };
}

async function httpJson(method, path, { body, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const meta = loadExperimentMeta();
  const startedAt = new Date().toISOString();
  const result = {
    experiment: meta.title,
    hypothesis:
      "Latencia inyectada Sports→Hotel eleva p95 del flujo y degrada éxito vs steady state",
    metric: "flujo http_req_duration p95 + flujo_success_rate",
    threshold: "p95 > 1500ms bajo fallo (cualitativo en runner; k6 mide en R0/R1)",
    intensityMs: latencyMs,
    durationHoldSeconds: holdSeconds,
    blastRadius: "cliente Hotel en proceso Sports (lab)",
    abortConditions: ["health/ready != 200", "activate != 200"],
    startedAt,
    steps: [],
  };

  try {
    const ready = await httpJson("GET", "/health/ready");
    assert(ready.status === 200, `abort: ready=${ready.status}`);
    result.steps.push({ step: "steady-ready", ok: true });

    const before = await httpJson("GET", "/chaos/hotel-latency");
    assert(before.status === 200 && before.json?.enabled === false, "abort: fault already on");
    result.steps.push({ step: "steady-fault-off", ok: true });

    const activate = await httpJson("POST", "/chaos/hotel-latency", {
      body: { token, latencyMs, ttlMs },
    });
    assert(activate.status === 200 && activate.json?.enabled === true, "abort: activate failed");
    result.steps.push({ step: "activate", ok: true, state: activate.json });

    await new Promise((r) => setTimeout(r, holdSeconds * 1000));
    result.steps.push({ step: "hold", ok: true, seconds: holdSeconds });
  } finally {
    const rollback = await httpJson("DELETE", "/chaos/hotel-latency", {
      headers: { "x-chaos-token": token },
    }).catch((e) => ({ status: 0, json: { error: String(e) } }));
    result.steps.push({ step: "rollback", status: rollback.status, state: rollback.json });

    const after = await httpJson("GET", "/chaos/hotel-latency").catch(() => ({
      status: 0,
      json: null,
    }));
    result.steps.push({
      step: "verify-off",
      ok: after.json?.enabled === false,
      state: after.json,
    });
    result.finishedAt = new Date().toISOString();
  }

  const outDir = resolve(root, "chaos/results");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `hotel-latency-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${outFile}`);

  const verify = result.steps.find((s) => s.step === "verify-off");
  if (!verify?.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
