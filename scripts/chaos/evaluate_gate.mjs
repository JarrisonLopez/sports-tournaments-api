#!/usr/bin/env node
/**
 * Evalúa chaos/results/rounds-latest.json con criterios a priori.
 * Uso:
 *   node scripts/chaos/evaluate_gate.mjs
 *   node scripts/chaos/evaluate_gate.mjs --fixture chaos/results/fixtures/gate-reject-zero-success.json
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function evaluate(report) {
  const failures = [];
  const { baseline, r0, r1 } = report;

  if (!baseline || !r0 || !r1) {
    failures.push("missing baseline/r0/r1");
    return { ok: false, failures };
  }

  if (!(r0.p95SuccessMs > baseline.p95SuccessMs * 1.5)) {
    failures.push("R0 did not degrade p95Success vs baseline");
  }

  if (r1.successRate <= 0) {
    failures.push("R1 successRate is 0 — hard reject");
  }

  if (r1.successRate < 0.9) {
    failures.push(`R1 successRate ${r1.successRate} < 0.9`);
  }

  const p95Improved =
    r1.p95SuccessMs != null &&
    r0.p95SuccessMs != null &&
    r1.p95SuccessMs <= r0.p95SuccessMs * 0.7;
  const sloImproved =
    typeof r1.withinSloOfTotal === "number" &&
    typeof r0.withinSloOfTotal === "number" &&
    r1.withinSloOfTotal >= r0.withinSloOfTotal + 0.2;

  if (!p95Improved && !sloImproved) {
    failures.push("R1 did not improve p95Success or withinSloOfTotal vs R0");
  }

  // Errores no pueden inflar SLO: withinSloRate se define sobre éxitos.
  if (r1.errors > 0 && r1.withinSloOfTotal > r1.successRate + 1e-9) {
    failures.push("SLO accounting exceeds success rate (errors counted as SLO)");
  }

  return { ok: failures.length === 0, failures, p95Improved, sloImproved };
}

const args = process.argv.slice(2);
const fixtureIdx = args.indexOf("--fixture");
const reportPath =
  fixtureIdx >= 0
    ? resolve(root, args[fixtureIdx + 1])
    : resolve(root, "chaos/results/rounds-latest.json");

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const result = evaluate(report);
console.log(JSON.stringify({ reportPath, ...result }, null, 2));
process.exit(result.ok ? 0 : 1);
