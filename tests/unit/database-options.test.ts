import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppDataSource } from "../../src/config/database";

const SYNC_ENV_KEYS = [
  "SYNCHRONIZE",
  "TYPEORM_SYNCHRONIZE",
  "DB_SYNCHRONIZE",
  "TYPEORM_MIGRATIONS_RUN",
  "TYPEORM_DROP_SCHEMA",
] as const;

describe("opciones TypeORM de Canary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("deja synchronize, migrationsRun y dropSchema en false", () => {
    expect(AppDataSource.options.synchronize).toBe(false);
    expect(AppDataSource.options.migrationsRun).toBe(false);
    expect(AppDataSource.options.dropSchema).toBe(false);

    const source = readFileSync("src/config/database.ts", "utf8");
    expect(source).toContain("synchronize: false");
    expect(source).toContain("migrationsRun: false");
    expect(source).toContain("dropSchema: false");
    expect(source).not.toContain("synchronize: true");
  });

  it("ninguna variable de entorno activa la sincronización", async () => {
    for (const key of SYNC_ENV_KEYS) {
      vi.stubEnv(key, "true");
    }

    vi.resetModules();
    const fresh = await import("../../src/config/database");

    expect(fresh.AppDataSource.options.synchronize).toBe(false);
    expect(fresh.AppDataSource.options.migrationsRun).toBe(false);
    expect(fresh.AppDataSource.options.dropSchema).toBe(false);
    expect(fresh.AppDataSource).not.toBe(AppDataSource);
  });
});
