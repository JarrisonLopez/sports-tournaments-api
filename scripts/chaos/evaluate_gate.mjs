#!/usr/bin/env node
/**
 * Evalúa un reporte Baseline/R0/R1 (chaos/results/rounds-latest.json por defecto).
 *
 * Distingue:
 * - fullSuccess / fullSuccessRate  → respuesta completa (Hotel real)
 * - partial / partialRate          → fallback degradado válido
 * - availabilityRate (successRate) → HTTP/negocio disponible (full+partial)
 * - errors / errorRate             → fallo duro
 *
 * No trata parcial como éxito completo.
 * No relaja umbrales a priori (ver thresholdsAPriori en run_rounds.mjs).
 *
 * Fixtures bajo chaos/results/fixtures/ son sintéticos: no son evidencia AWS/OCI/GCP.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

/** Umbrales a priori del experimento de latencia Hotel (local-mocks / rounds). */
export const GATE_THRESHOLDS = Object.freeze({
  minR1AvailabilityRate: 0.9,
  minR0FullSuccessRate: 0.9,
  maxR1P95SuccessRatioVsR0: 0.7,
  minSloImprovementVsR0: 0.2,
  minR0P95DegradationVsBaseline: 1.5,
  rejectIfR1AvailabilityIsZero: true,
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function rate(round, keyCount, fallbackRateKey) {
  if (isFiniteNumber(round[fallbackRateKey])) {
    return round[fallbackRateKey];
  }
  const n = round.requests || 0;
  if (!n) return 0;
  const count = round[keyCount];
  if (!isFiniteNumber(count)) return 0;
  return count / n;
}

function validateRound(name, round) {
  const failures = [];
  if (!round || typeof round !== "object" || Array.isArray(round)) {
    failures.push(`${name} is missing or not an object`);
    return failures;
  }

  const requiredFinite = ["requests", "p95SuccessMs"];
  for (const key of requiredFinite) {
    if (!isFiniteNumber(round[key])) {
      failures.push(`${name}.${key} must be a finite number`);
    }
  }

  const hasAvailability =
    isFiniteNumber(round.availabilityRate) ||
    isFiniteNumber(round.successRate) ||
    (isFiniteNumber(round.success) && isFiniteNumber(round.requests));
  if (!hasAvailability) {
    failures.push(
      `${name} missing availabilityRate/successRate (or success+requests)`,
    );
  }

  const hasFull =
    isFiniteNumber(round.fullSuccessRate) ||
    (isFiniteNumber(round.fullSuccess) && isFiniteNumber(round.requests));
  if (name === "r0" && !hasFull) {
    failures.push(`${name} missing fullSuccessRate (or fullSuccess+requests)`);
  }

  return failures;
}

export function evaluate(report) {
  const failures = [];
  const notes = [];

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return {
      ok: false,
      verdict: "FAIL",
      failures: ["report must be a JSON object"],
      notes,
    };
  }

  if (report._synthetic === true || report.synthetic === true) {
    notes.push(
      "Input marked SYNTHETIC fixture — not real AWS/OCI/GCP experiment evidence",
    );
  }

  const { baseline, r0, r1 } = report;

  if (!baseline || !r0 || !r1) {
    failures.push("missing baseline/r0/r1");
    return { ok: false, verdict: "FAIL", failures, notes };
  }

  failures.push(...validateRound("baseline", baseline));
  failures.push(...validateRound("r0", r0));
  failures.push(...validateRound("r1", r1));
  if (failures.length) {
    return { ok: false, verdict: "FAIL", failures, notes };
  }

  const r0Full = rate(r0, "fullSuccess", "fullSuccessRate");
  const r1Full = rate(r1, "fullSuccess", "fullSuccessRate");
  const r1Partial = rate(r1, "partial", "partialRate");
  const r1Avail = isFiniteNumber(r1.availabilityRate)
    ? r1.availabilityRate
    : rate(r1, "success", "successRate");
  const r0Avail = isFiniteNumber(r0.availabilityRate)
    ? r0.availabilityRate
    : rate(r0, "success", "successRate");

  if (![r0Full, r1Full, r1Partial, r1Avail, r0Avail].every(isFiniteNumber)) {
    failures.push("derived rates are not finite — rejecting incomplete metrics");
    return { ok: false, verdict: "FAIL", failures, notes };
  }

  // R0 bajo fallo debe degradar latencia de respuestas disponibles.
  if (
    !(
      r0.p95SuccessMs >
      baseline.p95SuccessMs * GATE_THRESHOLDS.minR0P95DegradationVsBaseline
    )
  ) {
    failures.push("R0 did not degrade p95Success vs baseline");
  }

  // R0 debería conservar respuestas completas (Hotel real) bajo latencia.
  if (r0Full < GATE_THRESHOLDS.minR0FullSuccessRate) {
    failures.push(
      `R0 fullSuccessRate ${r0Full} < ${GATE_THRESHOLDS.minR0FullSuccessRate} (expected complete responses)`,
    );
  }

  if (GATE_THRESHOLDS.rejectIfR1AvailabilityIsZero && r1Avail <= 0) {
    failures.push("R1 availabilityRate is 0 — hard reject");
  }

  if (r1Avail < GATE_THRESHOLDS.minR1AvailabilityRate) {
    failures.push(
      `R1 availabilityRate ${r1Avail} < ${GATE_THRESHOLDS.minR1AvailabilityRate}`,
    );
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
  if (isFiniteNumber(r1.fullSuccess) && isFiniteNumber(r1.requests)) {
    const accounted =
      (r1.fullSuccess || 0) + (r1.partial || 0) + (r1.errors || 0);
    if (accounted !== r1.requests) {
      failures.push(
        `R1 counts inconsistent: full+partial+errors=${accounted} requests=${r1.requests}`,
      );
    }
  }

  const p95Improved =
    isFiniteNumber(r1.p95SuccessMs) &&
    isFiniteNumber(r0.p95SuccessMs) &&
    r1.p95SuccessMs <=
      r0.p95SuccessMs * GATE_THRESHOLDS.maxR1P95SuccessRatioVsR0;
  const sloImproved =
    isFiniteNumber(r1.withinSloOfTotal) &&
    isFiniteNumber(r0.withinSloOfTotal) &&
    r1.withinSloOfTotal >=
      r0.withinSloOfTotal + GATE_THRESHOLDS.minSloImprovementVsR0;

  if (!p95Improved && !sloImproved) {
    failures.push("R1 did not improve p95Success or withinSloOfTotal vs R0");
  }

  if (
    isFiniteNumber(r1.errors) &&
    r1.errors > 0 &&
    isFiniteNumber(r1.withinSloOfTotal) &&
    r1.withinSloOfTotal > r1Avail + 1e-9
  ) {
    failures.push("SLO accounting exceeds availability (errors counted as SLO)");
  }

  // Gate must not claim "full success" improvement when R1 is all partial.
  if (r1Full < 0.1 && r0Full >= 0.9) {
    notes.push(
      "Hypothesis scope: availability+latency improved via partial fallback; fullSuccess dropped as expected under injected Hotel latency",
    );
  }

  const ok = failures.length === 0;
  return {
    ok,
    verdict: ok ? "PASS" : "FAIL",
    failures,
    notes,
    thresholds: GATE_THRESHOLDS,
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

export function loadReport(reportPath) {
  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    throw new Error(`cannot read report: ${message}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON — report is corrupt or not parseable");
  }
}

function main(argv = process.argv.slice(2)) {
  const fixtureIdx = argv.indexOf("--fixture");
  const reportPath =
    fixtureIdx >= 0
      ? resolve(root, argv[fixtureIdx + 1])
      : resolve(root, "chaos/results/rounds-latest.json");

  let report;
  try {
    report = loadReport(reportPath);
  } catch (err) {
    const payload = {
      reportPath,
      ok: false,
      verdict: "FAIL",
      failures: [err.message || String(err)],
      notes: [],
    };
    console.log(JSON.stringify(payload, null, 2));
    console.log("Chaos Gate: FAIL");
    process.exitCode = 1;
    return;
  }

  const result = evaluate(report);
  console.log(JSON.stringify({ reportPath, ...result }, null, 2));
  console.log(`Chaos Gate: ${result.verdict}`);
  process.exitCode = result.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main();
}
