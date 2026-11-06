import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import {
  assertStartupSchema,
  startupSchemaStatements,
} from "../../src/schema/startup-schema";
import { bootApplication, type StartupDatabase } from "../../src/startup";

describe("comprobación de esquema al arrancar Stable", () => {
  it("solo emite lecturas de las columnas de las tres tablas", () => {
    const statements = startupSchemaStatements();

    expect(statements).toEqual([
      "SELECT `id`, `nombre`, `deporte`, `fechaInicio`, `fechaFin`, `estado` FROM `torneos` WHERE 0 = 1",
      "SELECT `id`, `nombre`, `ubicacion`, `tipoSuperficie`, `disponible` FROM `canchas` WHERE 0 = 1",
      "SELECT `id`, `nombre`, `documento`, `fechaNacimiento`, `posicion` FROM `jugadores` WHERE 0 = 1",
    ]);
    expect(statements.join("\n")).not.toMatch(
      /\b(insert|update|delete|create|alter|drop|truncate|replace)\b/i,
    );
  });

  it("una base sin tablas falla antes de escuchar HTTP y cierra la conexión", async () => {
    const database = fakeDatabase(() => {
      throw driverError("Table 'sports_db.torneos' doesn't exist", 1146);
    });
    const listen = vi.fn(async () => undefined);

    await expect(bootApplication(database, listen)).rejects.toThrow(
      "Falta la tabla requerida: torneos",
    );
    expect(listen).not.toHaveBeenCalled();
    expect(database.destroy).toHaveBeenCalledTimes(1);
    expect(database.isInitialized).toBe(false);
  });

  it("una columna ausente nombra la tabla y la columna sin repetir el error del driver", async () => {
    const database = fakeDatabase((sql) => {
      if (sql.includes("FROM `canchas`")) {
        throw driverError(
          "Unknown column 'disponible' in 'field list' for secret-user",
          1054,
        );
      }
    });
    const listen = vi.fn(async () => undefined);

    await expect(bootApplication(database, listen)).rejects.toThrow(
      "Falta la columna requerida: canchas.disponible",
    );
    expect(listen).not.toHaveBeenCalled();
    expect(database.destroy).toHaveBeenCalledTimes(1);
  });

  it("oculta credenciales y mensajes no clasificados", async () => {
    const database = fakeDatabase(() => {
      throw driverError("Access denied for user 'sports_user' (using password: YES)", 1045);
    });

    await expect(bootApplication(database, async () => undefined)).rejects.toThrow(
      "No se pudo comprobar el esquema de torneos",
    );
    await expect(assertStartupSchema(database.query)).rejects.not.toThrow(/sports_user|password/i);
  });

  it("una base compatible permite arrancar sin modificar datos ni esquema", async () => {
    const database = fakeDatabase(() => undefined);
    const listen = vi.fn(async () => undefined);

    await bootApplication(database, listen);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(database.destroy).not.toHaveBeenCalled();
    expect(database.queries).toEqual(startupSchemaStatements());
  });

  it("conserva rutas y métricas de Stable y no incorpora v4 ni fault injection", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.2", track: "stable" },
    });
    const live = await app.inject({ method: "GET", url: "/health/live" });
    const missing = await app.inject({ method: "GET", url: "/api/v4/torneos/estadisticas" });

    expect(live.statusCode).toBe(200);
    expect(live.headers["x-api-version"]).toBe("3.0.2");
    expect(live.headers["x-api-track"]).toBe("stable");
    expect(missing.statusCode).toBe(404);

    const routes = app.printRoutes();
    expect(routes).toContain("live (GET, HEAD)");
    expect(routes).toContain("ready (GET, HEAD)");
    expect(routes).not.toContain("estadisticas");
    expect(routes).not.toContain("proximos");
    expect(routes).not.toContain("resumen");
    await app.close();

    const source = readSrc("src");
    expect(source).not.toMatch(/fault-injection|faultInjection/);
    expect(source).not.toContain("/api/v4");
    expect(readFileSync("src/app.ts", "utf8")).toContain("registerRedMetrics");
    expect(readFileSync("src/observability/metrics.ts", "utf8")).toContain("registerRedMetrics");
  });
});

function readSrc(directory: string): string {
  return readdirSync(directory)
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        return [readSrc(fullPath)];
      }
      return fullPath.endsWith(".ts") ? [readFileSync(fullPath, "utf8")] : [];
    })
    .join("\n");
}

function fakeDatabase(onQuery: (sql: string) => void): StartupDatabase & {
  queries: string[];
  destroy: ReturnType<typeof vi.fn>;
  query: (sql: string) => Promise<unknown>;
} {
  const queries: string[] = [];
  const database = {
    queries,
    isInitialized: false,
    initialize: vi.fn(async () => {
      database.isInitialized = true;
    }),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      onQuery(sql);
      return [];
    }),
    destroy: vi.fn(async () => {
      database.isInitialized = false;
    }),
  };

  return database;
}

function driverError(message: string, errno: number): Error & { errno: number } {
  const error = new Error(message) as Error & { errno: number };
  error.errno = errno;
  return error;
}
