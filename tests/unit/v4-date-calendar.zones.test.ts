import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ZONES = [
  "UTC",
  "America/Bogota",
  "Asia/Tokyo",
  "Pacific/Kiritimati",
];

describe("DATE de calendario en procesos con TZ aislada", () => {
  it.each(ZONES)("conserva 2026-11-05 en %s", (zone) => {
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/vitest/vitest.mjs"),
        "run",
        "tests/unit/v4-date-calendar.child.test.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TZ: zone,
        },
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
