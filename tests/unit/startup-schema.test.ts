import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import {
  assertStartupSchema,
  StartupSchemaError,
  startupSchemaStatements,
} from "../../src/schema/startup-schema";
import { bootCanary, type StartupDatabase } from "../../src/startup";

describe("comprobación de esquema al arrancar", () => {
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

    await expect(bootCanary(database, listen)).rejects.toThrow(
      "Falta la tabla requerida: torneos",
    );
    expect(listen).not.toHaveBeenCalled();
    expect(database.destroy).toHaveBeenCalledTimes(1);
    expect(database.isInitialized).toBe(false);
    expect(database.queries).toEqual([startupSchemaStatements()[0]]);
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

    await expect(bootCanary(database, listen)).rejects.toThrow(
      "Falta la columna requerida: canchas.disponible",
    );
    expect(listen).not.toHaveBeenCalled();
    expect(database.destroy).toHaveBeenCalledTimes(1);
  });

  it("oculta credenciales y mensajes no clasificados", async () => {
    const database = fakeDatabase(() => {
      throw driverError("Access denied for user 'sports_user' (using password: YES)", 1045);
    });

    await expect(bootCanary(database, async () => undefined)).rejects.toThrow(
      "No se pudo comprobar el esquema de torneos",
    );
    await expect(bootCanary(database, async () => undefined)).rejects.not.toThrow(
      /sports_user|password/i,
    );
  });

  it("una base compatible permite arrancar sin modificar datos ni esquema", async () => {
    const database = fakeDatabase(() => undefined);
    const listen = vi.fn(async () => undefined);

    await bootCanary(database, listen);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(database.destroy).not.toHaveBeenCalled();
    expect(database.isInitialized).toBe(true);
    expect(database.queries).toEqual(startupSchemaStatements());
  });

  it("si escuchar falla, cierra la base ya inicializada", async () => {
    const database = fakeDatabase(() => undefined);

    await expect(
      bootCanary(database, async () => {
        throw new Error("puerto ocupado");
      }),
    ).rejects.toThrow("puerto ocupado");
    expect(database.destroy).toHaveBeenCalledTimes(1);
    expect(database.isInitialized).toBe(false);
  });

  it("conserva las rutas v4 y las cabeceras de salud", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "v4", track: "canary" },
    });
    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-api-version"]).toBe("v4");
    expect(response.headers["x-api-track"]).toBe("canary");

    const routes = app.printRoutes();
    expect(routes).toContain("live (GET, HEAD)");
    expect(routes).toContain("ready (GET, HEAD)");
    expect(routes).toContain("estadisticas (GET, HEAD)");
    expect(routes).toContain("proximos (GET, HEAD)");
    expect(routes).toContain("resumen (GET, HEAD)");
    await app.close();
  });
});

function fakeDatabase(onQuery: (sql: string) => void): StartupDatabase & {
  queries: string[];
  destroy: ReturnType<typeof vi.fn>;
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
