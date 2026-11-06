import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadCloudSqlDriverOptions,
  openAppDataSource,
  planMysqlConnection,
} from "../../src/config/database";

const INSTANCE = "sports-tournaments-multicloud:us-central1:sports-demo-mysql";

describe("conexión MySQL 8.4", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("mantiene TCP local cuando DB_HOST está definido", () => {
    expect(
      planMysqlConnection({
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        CLOUD_SQL_CONNECTION_NAME: INSTANCE,
      }),
    ).toEqual({
      mode: "tcp",
      host: "127.0.0.1",
      port: 3306,
    });
  });

  it("elige el conector solo sin DB_HOST y con un connection name válido", () => {
    expect(
      planMysqlConnection({
        CLOUD_SQL_CONNECTION_NAME: INSTANCE,
      }),
    ).toEqual({
      mode: "cloud-sql-connector",
      instanceConnectionName: INSTANCE,
    });
  });

  it("no imprime un connection name inválido", () => {
    const secret = "SECRETO-NO-IMPRIMIR";

    expect(() =>
      planMysqlConnection({ CLOUD_SQL_CONNECTION_NAME: secret }),
    ).toThrow(/proyecto:region:instancia/);

    try {
      planMysqlConnection({ CLOUD_SQL_CONNECTION_NAME: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("no abre el conector real durante Vitest", async () => {
    await expect(loadCloudSqlDriverOptions(INSTANCE)).rejects.toThrow(
      /no se abre durante las pruebas/,
    );
  });

  it("pasa el stream del conector a TypeORM sin socket Unix ni conexión", async () => {
    vi.resetModules();
    const database = await import("../../src/config/database");
    let closed = false;

    const dataSource = await database.openAppDataSource(
      {
        CLOUD_SQL_CONNECTION_NAME: INSTANCE,
        DB_USER: "sports_user",
        DB_PASSWORD: "no-se-registra",
        DB_NAME: "sports_db",
      },
      async () => ({
        extra: {
          stream: () => Promise.reject(new Error("no dial")),
        },
        close: async () => {
          closed = true;
        },
      }),
    );

    expect(dataSource.options.synchronize).toBe(false);
    expect(dataSource.options.migrationsRun).toBe(false);
    expect(dataSource.options.dropSchema).toBe(false);
    expect(dataSource.isInitialized).toBe(false);
    expect(dataSource.options.extra).toHaveProperty("stream");
    expect(JSON.stringify(dataSource.options.extra)).not.toContain("socketPath");
    expect(JSON.stringify(dataSource.options.extra)).not.toContain("/cloudsql/");
    expect(JSON.stringify(dataSource.options.extra)).not.toContain("no-se-registra");

    await database.closeCloudSqlConnector();
    expect(closed).toBe(true);
    expect(openAppDataSource).toBeTypeOf("function");
  });
});
