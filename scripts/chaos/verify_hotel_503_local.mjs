#!/usr/bin/env node
/**
 * Wrapper: prueba local HTTP 503 vía Vitest (servidor mock, sin OCI).
 *
 *   node scripts/chaos/verify_hotel_503_local.mjs
 *   npm test -- tests/integration/hotel-503-resilience.test.ts
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const result = spawnSync(
  "npx",
  ["vitest", "run", "tests/integration/hotel-503-resilience.test.ts", "tests/unit/hotel-resilience.test.ts", "tests/unit/hotel-fallback.test.ts"],
  { cwd: root, stdio: "inherit", shell: true },
);
process.exit(result.status ?? 1);
