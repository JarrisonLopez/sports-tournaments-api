import mysql from "mysql2/promise";
import { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";

import { Cancha } from "../../src/entities/Cancha";
import { Jugador } from "../../src/entities/Jugador";
import { Torneo } from "../../src/entities/Torneo";
import { executeBootstrapCommand } from "../../src/schema/bootstrap-cli";
import { applicationChecksum } from "../../src/schema/canonical-schema";
import {
  adoptBootstrap,
  applyBootstrap,
  BootstrapRejectedError,
  loadSnapshot,
  planBootstrap,
  targetFromEnv,
  type SqlClient,
} from "../../src/schema/bootstrap";

const enabled = process.env.SCHEMA_BOOTSTRAP_DOCKER === "1";
const password = process.env.SCHEMA_BOOTSTRAP_PASSWORD ?? "";
const rootPassword = process.env.SCHEMA_BOOTSTRAP_ROOT_PASSWORD ?? "";
const port = Number(process.env.SCHEMA_BOOTSTRAP_PORT ?? "33066");

describe.skipIf(!enabled)("bootstrap sobre MySQL 8.4 desechable", () => {
  it("aplica, adopta, rechaza y conserva datos sin synchronize sobre la base poblada", async () => {
    const root = await mysql.createConnection({
      host: "127.0.0.1",
      port,
      user: "root",
      password: rootPassword,
      multipleStatements: false,
    });

    await root.query("CREATE DATABASE sports_bootstrap_sync");
    await root.query("CREATE DATABASE sports_bootstrap_bad");
    await root.query("CREATE DATABASE sports_bootstrap_locked");
    await root.query("GRANT ALL PRIVILEGES ON `sports_bootstrap_sync`.* TO 'sports_boot'@'%'");
    await root.query("GRANT ALL PRIVILEGES ON `sports_bootstrap_bad`.* TO 'sports_boot'@'%'");
    await root.query("GRANT SELECT ON `sports_bootstrap_locked`.* TO 'sports_boot'@'%'");
    await root.query("FLUSH PRIVILEGES");
    await root.end();

    const syncSource = new DataSource({
      type: "mysql",
      host: "127.0.0.1",
      port,
      username: "sports_boot",
      password,
      database: "sports_bootstrap_sync",
      entities: [Torneo, Cancha, Jugador],
      synchronize: true,
      logging: false,
    });
    await syncSource.initialize();
    await syncSource.destroy();

    const sync = await open("sports_bootstrap_sync");
    const syncPlan = await planBootstrap(sync.client, sync.target);
    expect(syncPlan.action).toBe("adoption-required");
    await expect(applyBootstrap(sync.client, confirmed("sports_bootstrap_sync"))).rejects.toBeInstanceOf(
      BootstrapRejectedError,
    );
    const beforeAdopt = await loadSnapshot(sync.client, "sports_bootstrap_sync");
    await adoptBootstrap(sync.client, confirmed("sports_bootstrap_sync"));
    const afterAdopt = await loadSnapshot(sync.client, "sports_bootstrap_sync");
    expect(afterAdopt.tables.filter((table) => table.name !== "schema_bootstrap_history")).toEqual(
      beforeAdopt.tables,
    );
    expect(afterAdopt.history).toEqual([
      expect.objectContaining({ version: "001-initial" }),
    ]);
    await expectNoSchemaDrift("sports_bootstrap_sync");
    await sync.connection.end();

    const empty = await open("sports_bootstrap_empty");
    expect((await planBootstrap(empty.client, empty.target)).action).toBe("apply");
    expect(await countTables(empty.connection, "sports_bootstrap_empty")).toBe(0);
    await applyBootstrap(empty.client, confirmed("sports_bootstrap_empty"));
    const bootstrapped = await loadSnapshot(empty.client, "sports_bootstrap_empty");
    const syncReader = await connect("sports_bootstrap_sync");
    const synchronized = await loadSnapshot(clientFor(syncReader), "sports_bootstrap_sync");
    await syncReader.end();
    expect(bootstrapped.tables.map((table) => table.name).sort()).toEqual([
      "canchas",
      "jugadores",
      "schema_bootstrap_history",
      "torneos",
    ]);
    expect(withoutHistory(bootstrapped.tables)).toEqual(withoutHistory(synchronized.tables));
    expect(bootstrapped.foreignKeys).toEqual([]);
    expect(await scalar(empty.connection, "SELECT COUNT(*) AS total FROM torneos")).toBe(0);

    await empty.connection.query(
      "INSERT INTO torneos (nombre, deporte, fechaInicio, fechaFin, estado) VALUES ('Conservar', 'Ajedrez', '2026-11-05', '2026-11-05', 'PROGRAMADO')",
    );
    const repeated = await applyBootstrap(empty.client, confirmed("sports_bootstrap_empty"));
    expect(repeated.action).toBe("already-applied");
    expect(await scalar(empty.connection, "SELECT COUNT(*) AS total FROM torneos")).toBe(1);
    expect(await scalar(empty.connection, "SELECT COUNT(*) AS total FROM schema_bootstrap_history")).toBe(1);
    await expectNoSchemaDrift("sports_bootstrap_empty");
    await empty.connection.end();

    const badConnection = await connect("sports_bootstrap_bad");
    await badConnection.query("CREATE TABLE torneos (id int NOT NULL, PRIMARY KEY (id))");
    const bad = clientFor(badConnection);
    await expect(applyBootstrap(bad, confirmed("sports_bootstrap_bad"))).rejects.toThrow(
      /tipo, nulabilidad|faltan tablas|distinto/,
    );
    const [badColumns] = await badConnection.query("SHOW COLUMNS FROM torneos");
    expect(badColumns).toHaveLength(1);
    await badConnection.end();

    const locked = await open("sports_bootstrap_locked");
    await expect(applyBootstrap(locked.client, confirmed("sports_bootstrap_locked"))).rejects.toThrow(
      /no se revierte/,
    );
    await expect(applyBootstrap(locked.client, confirmed("sports_bootstrap_locked"))).rejects.not.toThrow(
      new RegExp(escapeRegExp(password)),
    );
    expect(await countTables(locked.connection, "sports_bootstrap_locked")).toBe(0);
    await locked.connection.end();
  });

  it("plan no escribe y apply hereda utf8mb4_unicode_ci", async () => {
    const root = await mysql.createConnection({
      host: "127.0.0.1",
      port,
      user: "root",
      password: rootPassword,
      multipleStatements: false,
    });
    await root.query(
      "CREATE DATABASE sports_bootstrap_unicode CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
    await root.query(
      "GRANT ALL PRIVILEGES ON `sports_bootstrap_unicode`.* TO 'sports_boot'@'%'",
    );
    await root.query("FLUSH PRIVILEGES");
    await root.query("SET GLOBAL log_output = 'TABLE'");
    await root.query("SET GLOBAL general_log = 'OFF'");
    await root.query("TRUNCATE TABLE mysql.general_log");
    await root.query("SET GLOBAL general_log = 'ON'");

    const lines: string[] = [];
    const planCode = await executeBootstrapCommand(
      ["plan"],
      bootstrapEnv("sports_bootstrap_unicode"),
      (line) => lines.push(line),
    );
    await root.query("SET GLOBAL general_log = 'OFF'");
    const [logged] = await root.query(
      "SELECT argument FROM mysql.general_log WHERE command_type = 'Query'",
    );
    const statements = (logged as { argument: string }[]).map((row) => String(row.argument));
    expect(planCode).toBe(0);
    expect(lines.join("\n")).toContain("accion=apply");
    expect(statements.some((sql) => /^(create|alter|drop|truncate|insert|update|delete|rename)\b/i.test(sql.trim()))).toBe(false);
    expect(await countTables(root, "sports_bootstrap_unicode")).toBe(0);

    const applyLines: string[] = [];
    const applyCode = await executeBootstrapCommand(
      ["apply", "--confirm", "sports_bootstrap_unicode"],
      bootstrapEnv("sports_bootstrap_unicode"),
      (line) => applyLines.push(line),
    );
    expect(applyCode).toBe(0);
    expect(applyLines.join("\n")).toContain("accion=already-applied");
    expect(applyLines.join("\n")).not.toContain(password);

    const [collation] = await root.query(
      `SELECT TABLE_NAME, TABLE_COLLATION, ENGINE
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'sports_bootstrap_unicode'
       ORDER BY TABLE_NAME`,
    );
    expect(collation).toEqual([
      { TABLE_NAME: "canchas", TABLE_COLLATION: "utf8mb4_unicode_ci", ENGINE: "InnoDB" },
      { TABLE_NAME: "jugadores", TABLE_COLLATION: "utf8mb4_unicode_ci", ENGINE: "InnoDB" },
      { TABLE_NAME: "schema_bootstrap_history", TABLE_COLLATION: "utf8mb4_unicode_ci", ENGINE: "InnoDB" },
      { TABLE_NAME: "torneos", TABLE_COLLATION: "utf8mb4_unicode_ci", ENGINE: "InnoDB" },
    ]);
    const [columns] = await root.query(
      `SELECT COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'sports_bootstrap_unicode' AND TABLE_NAME = 'torneos' AND COLUMN_NAME = 'deporte'`,
    );
    expect(columns).toEqual([
      {
        COLUMN_NAME: "deporte",
        CHARACTER_SET_NAME: "utf8mb4",
        COLLATION_NAME: "utf8mb4_unicode_ci",
      },
    ]);

    const unicode = await connect("sports_bootstrap_unicode");
    await unicode.query(
      "INSERT INTO torneos (nombre, deporte, fechaInicio, fechaFin, estado) VALUES ('Conservar', 'Ajedrez', '2026-11-05', '2026-11-05', 'PROGRAMADO')",
    );
    const second = await executeBootstrapCommand(
      ["apply", "--confirm", "sports_bootstrap_unicode"],
      bootstrapEnv("sports_bootstrap_unicode"),
      () => undefined,
    );
    expect(second).toBe(0);
    expect(await scalar(unicode, "SELECT COUNT(*) AS total FROM torneos")).toBe(1);
    const [history] = await unicode.query(
      "SELECT version, checksum FROM schema_bootstrap_history",
    );
    expect(history).toEqual([
      { version: "001-initial", checksum: applicationChecksum() },
    ]);

    await root.query(
      "UPDATE sports_bootstrap_unicode.schema_bootstrap_history SET checksum = 'incorrecto'",
    );
    const rejectedLines: string[] = [];
    const rejected = await executeBootstrapCommand(
      ["apply", "--confirm", "sports_bootstrap_unicode"],
      bootstrapEnv("sports_bootstrap_unicode"),
      (line) => rejectedLines.push(line),
    );
    expect(rejected).toBe(1);
    expect(rejectedLines.join("\n")).toMatch(/checksum/);
    expect(rejectedLines.join("\n")).not.toContain("accion=already-applied");
    expect(await scalar(unicode, "SELECT COUNT(*) AS total FROM torneos")).toBe(1);

    await root.query(
      "CREATE DATABASE sports_bootstrap_partial CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
    await root.query(
      "GRANT ALL PRIVILEGES ON `sports_bootstrap_partial`.* TO 'sports_boot'@'%'",
    );
    await root.query("FLUSH PRIVILEGES");
    const partial = await connect("sports_bootstrap_partial");
    await partial.query("CREATE TABLE canchas (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB");
    const partialLines: string[] = [];
    const partialCode = await executeBootstrapCommand(
      ["apply", "--confirm", "sports_bootstrap_partial"],
      bootstrapEnv("sports_bootstrap_partial"),
      (line) => partialLines.push(line),
    );
    expect(partialCode).toBe(1);
    expect(partialLines.join("\n")).toMatch(/faltan tablas|distinto/);
    expect(await countTables(partial, "sports_bootstrap_partial")).toBe(1);
    await partial.end();
    await unicode.end();
    await root.end();
  });
});

function bootstrapEnv(database: string): NodeJS.ProcessEnv {
  return {
    DB_HOST: "127.0.0.1",
    DB_PORT: String(port),
    DB_USER: "sports_boot",
    DB_PASSWORD: password,
    DB_NAME: database,
    DB_BOOTSTRAP_ALLOW_HOST: "127.0.0.1",
  };
}

function confirmed(database: string) {
  return targetFromEnv(
    {
      DB_HOST: "127.0.0.1",
      DB_PORT: String(port),
      DB_USER: "sports_boot",
      DB_PASSWORD: password,
      DB_NAME: database,
      DB_BOOTSTRAP_ALLOW_HOST: "127.0.0.1",
    },
    database,
  );
}

async function open(database: string) {
  const connection = await connect(database);
  return { connection, client: clientFor(connection), target: targetFromEnv({
    DB_HOST: "127.0.0.1",
    DB_PORT: String(port),
    DB_USER: "sports_boot",
    DB_PASSWORD: password,
    DB_NAME: database,
    DB_BOOTSTRAP_ALLOW_HOST: "127.0.0.1",
  }) };
}

async function connect(database: string) {
  return mysql.createConnection({
    host: "127.0.0.1",
    port,
    user: "sports_boot",
    password,
    database,
    multipleStatements: false,
  });
}

function clientFor(connection: mysql.Connection): SqlClient {
  return {
    async query(sql, params) {
      const [rows] = await connection.query(sql, params ? [...params] : []);
      return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    },
  };
}

async function countTables(connection: mysql.Connection, database: string): Promise<number> {
  return scalar(
    connection,
    "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [database],
  );
}

async function scalar(
  connection: mysql.Connection,
  sql: string,
  params: readonly unknown[] = [],
): Promise<number> {
  const [rows] = await connection.query(sql, [...params]);
  const row = (rows as { total: number }[])[0];
  return Number(row?.total ?? 0);
}

function withoutHistory<T extends { name: string }>(tables: T[]): T[] {
  return tables.filter((table) => table.name !== "schema_bootstrap_history");
}

async function expectNoSchemaDrift(database: string): Promise<void> {
  const probe = new DataSource({
    type: "mysql",
    host: "127.0.0.1",
    port,
    username: "sports_boot",
    password,
    database,
    entities: [Torneo, Cancha, Jugador],
    synchronize: false,
    logging: false,
  });
  await probe.initialize();

  try {
    const pending = await probe.driver.createSchemaBuilder().log();
    expect(pending.upQueries).toEqual([]);
  } finally {
    await probe.destroy();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
