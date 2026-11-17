#!/usr/bin/env node
/**
 * Evalúa chaos/results/rounds-latest.json.
 *
 * Distingue:
 * - fullSuccess / fullSuccessRate  → respuesta completa (Hotel real)
 * - partial / partialRate          → fallback degradado válido
 * - availabilityRate (successRate) → HTTP/negocio disponible (full+partial)
 * - errors / errorRate             → fallo duro
 *
 * No trata parcial como éxito completo.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rate(round, keyCount, fallbackRateKey) {
  if (typeof round[fallbackRateKey] === "number") {
    return round[fallbackRateKey];
  }
  const n = round.requests || 0;
  if (!n) return 0;
  return (round[keyCount] || 0) / n;
}

function evaluate(report) {
  const failures = [];
  const notes = [];
  const { baseline, r0, r1 } = report;

  if (!baseline || !r0 || !r1) {
    failures.push("missing baseline/r0/r1");
    return { ok: false, failures, notes };
  }

  const r0Full = rate(r0, "fullSuccess", "fullSuccessRate");
  const r1Full = rate(r1, "fullSuccess", "fullSuccessRate");
  const r1Partial = rate(r1, "partial", "partialRate");
  const r1Avail =
    typeof r1.availabilityRate === "number"
      ? r1.availabilityRate
      : rate(r1, "success", "successRate");
  const r0Avail =
    typeof r0.availabilityRate === "number"
      ? r0.availabilityRate
      : rate(r0, "success", "successRate");

  // R0 bajo fallo debe degradar latencia de respuestas disponibles.
  if (!(r0.p95SuccessMs > baseline.p95SuccessMs * 1.5)) {
    failures.push("R0 did not degrade p95Success vs baseline");
  }

  // R0 debería conservar respuestas completas (Hotel real) bajo latencia.
  if (r0Full < 0.9) {
    failures.push(`R0 fullSuccessRate ${r0Full} < 0.9 (expected complete responses)`);
  }

  if (r1Avail <= 0) {
    failures.push("R1 availabilityRate is 0 — hard reject");
  }

  if (r1Avail < 0.9) {
    failures.push(`R1 availabilityRate ${r1Avail} < 0.9`);
  }

  // No confundir parcial con completo.
  if (r1Partial > 0 && r1Full >= 0.9) {
    notes.push("R1 reports both high full and partial; verify classification");
  }
  if (r1Full === 0 && r1Partial >= 0.9) {
    notes.push(
      "R1 service level is PARTIAL (fallback), not full success — documented degradation of Hotel fidelity",
    );
  }
  if (typeof r1.fullSuccess === "number" && typeof r1.success === "number") {
    if (r1.fullSuccess + (r1.partial || 0) + (r1.errors || 0) !== r1.requests) {
      // allow if success field counts full+partial
      const accounted =
        (r1.fullSuccess || 0) + (r1.partial || 0) + (r1.errors || 0);
      if (accounted !== r1.requests) {
        failures.push(
          `R1 counts inconsistent: full+partial+errors=${accounted} requests=${r1.requests}`,
        );
      }
    }
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

  if (r1.errors > 0 && r1.withinSloOfTotal > r1Avail + 1e-9) {
    failures.push("SLO accounting exceeds availability (errors counted as SLO)");
  }

  // Gate must not claim "full success" improvement when R1 is all partial.
  if (r1Full < 0.1 && r0Full >= 0.9) {
    notes.push(
      "Hypothesis scope: availability+latency improved via partial fallback; fullSuccess dropped as expected under injected Hotel latency",
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    notes,
    rates: {
      r0Full,
      r0Avail,
      r1Full,
      r1Partial,
      r1Avail,
    },
    p95Improved,
    sloImproved,
  };
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
