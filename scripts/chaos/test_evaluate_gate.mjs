#!/usr/bin/env node
/**
 * Pruebas automatizadas del Chaos Gate con fixtures sintéticos.
 * No ejecuta caos real ni usa métricas cloud.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, loadReport, GATE_THRESHOLDS } from "./evaluate_gate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const gateScript = resolve(__dirname, "evaluate_gate.mjs");

const cases = [
  {
    name: "PASS — metrics meet a-priori thresholds",
    fixture: "chaos/results/fixtures/gate-accept-sample.json",
    expectOk: true,
    expectExit: 0,
  },
  {
    name: "FAIL — R1 availability zero",
    fixture: "chaos/results/fixtures/gate-reject-zero-success.json",
    expectOk: false,
    expectExit: 1,
  },
  {
    name: "FAIL — no p95/SLO improvement",
    fixture: "chaos/results/fixtures/gate-reject-no-improvement.json",
    expectOk: false,
    expectExit: 1,
  },
  {
    name: "FAIL — incomplete metrics",
    fixture: "chaos/results/fixtures/gate-reject-incomplete.json",
    expectOk: false,
    expectExit: 1,
  },
  {
    name: "FAIL — corrupt JSON",
    fixture: "chaos/results/fixtures/gate-reject-corrupt.json",
    expectOk: false,
    expectExit: 1,
  },
];

function runGate(fixtureRel) {
  const result = spawnSync(
    process.execPath,
    [gateScript, "--fixture", fixtureRel],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

let failed = 0;

console.log("Chaos Gate automated checks (SYNTHETIC fixtures only)");
console.log("Thresholds:", JSON.stringify(GATE_THRESHOLDS));

for (const testCase of cases) {
  const run = runGate(testCase.fixture);
  let payload = null;
  try {
    // stdout = pretty JSON object, then a single "Chaos Gate: VERDICT" line.
    const marker = run.stdout.lastIndexOf("\nChaos Gate:");
    const jsonText =
      marker >= 0 ? run.stdout.slice(0, marker).trim() : run.stdout.trim();
    payload = JSON.parse(jsonText);
  } catch {
    payload = null;
  }

  const exitOk = run.exitCode === testCase.expectExit;
  const verdictOk =
    payload &&
    payload.ok === testCase.expectOk &&
    payload.verdict === (testCase.expectOk ? "PASS" : "FAIL");

  const pass = exitOk && verdictOk;
  if (!pass) failed += 1;

  console.log(
    `${pass ? "OK" : "NOT OK"} | ${testCase.name} | exit=${run.exitCode} expected=${testCase.expectExit} | verdict=${payload?.verdict ?? "?"} ok=${payload?.ok}`,
  );
  if (!pass) {
    console.log("  stdout:", run.stdout.slice(0, 500));
    console.log("  stderr:", run.stderr.slice(0, 300));
  }
}

// In-process: incomplete must not evaluate as PASS
const incomplete = loadReport(
  resolve(root, "chaos/results/fixtures/gate-reject-incomplete.json"),
);
const incompleteResult = evaluate(incomplete);
if (incompleteResult.ok || incompleteResult.verdict !== "FAIL") {
  failed += 1;
  console.log("NOT OK | in-process incomplete rejected");
} else {
  console.log("OK | in-process incomplete rejected");
}

// In-process: accept sample PASS
const accept = loadReport(
  resolve(root, "chaos/results/fixtures/gate-accept-sample.json"),
);
const acceptResult = evaluate(accept);
if (!acceptResult.ok || acceptResult.verdict !== "PASS") {
  failed += 1;
  console.log("NOT OK | in-process accept PASS");
} else {
  console.log("OK | in-process accept PASS");
}

if (failed > 0) {
  console.error(`Chaos Gate tests FAILED (${failed})`);
  process.exit(1);
}

console.log("Chaos Gate tests PASS");
process.exit(0);
