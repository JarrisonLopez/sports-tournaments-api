import { spawn, type ChildProcess } from "node:child_process";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";

import { executeBootstrapCommand } from "../../src/schema/bootstrap-cli";

const enabled = process.env.CANARY_STARTUP_DOCKER === "1";
const port = Number(process.env.CANARY_STARTUP_PORT ?? "33067");
const password = process.env.CANARY_STARTUP_PASSWORD ?? "";
const rootPassword = process.env.CANARY_STARTUP_ROOT_PASSWORD ?? "";
const httpPort = Number(process.env.CANARY_STARTUP_HTTP_PORT ?? "18080");

describe.skipIf(!enabled)("arranque de Canary sobre MySQL 8.4 desechable", () => {
  const children: ChildProcess[] = [];

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null && !child.killed) {
        child.kill();
      }
    }
  });

  it("una base vacía no crea tablas ni abre HTTP", async () => {
    await createDatabase("canary_empty");
    const startedAt = await serverNow();
    const result = await runCanary("canary_empty", httpPort);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Falta la tabla requerida: torneos");
    expect(result.output).not.toContain("Server listening");
    await expect(fetch(`http://127.0.0.1:${httpPort}/health/live`)).rejects.toThrow();
    expect(await tableNames("canary_empty")).toEqual([]);
    const logged = await statementsBy("sports_boot", startedAt);
    expect(logged.some((statement) => statement.includes("WHERE 0 = 1"))).toBe(true);
    expect(logged.filter(isDdl)).toEqual([]);
  }, 60_000);

  it("una base bootstrapada arranca, responde v4 y no altera el esquema", async () => {
    await createDatabase("canary_ready");
    const bootstrapCode = await executeBootstrapCommand(
      ["apply", "--confirm", "canary_ready"],
      bootstrapEnv("canary_ready"),
    );
    expect(bootstrapCode).toBe(0);
    expect(await tableNames("canary_ready")).toEqual([
      "canchas",
      "jugadores",
      "schema_bootstrap_history",
      "torneos",
    ]);

    const root = await rootConnection("canary_ready");
    const [inserted] = await root.query(
      "INSERT INTO torneos (nombre, deporte, fechaInicio, fechaFin, estado) VALUES ('Copa Desechable', 'Ajedrez', '2026-12-01', '2026-12-03', 'PROGRAMADO')",
    );
    const torneoId = Number((inserted as { insertId: number }).insertId);
    await root.query(
      "INSERT INTO canchas (nombre, ubicacion, tipoSuperficie, disponible) VALUES ('Cancha Norte', 'Local', 'Madera', 1)",
    );
    await root.query(
      "INSERT INTO jugadores (nombre, documento, fechaNacimiento, posicion) VALUES ('Ana Prueba', 'DOC-100', '2000-01-02', 'Base')",
    );
    await root.end();

    const before = await schemaFingerprint("canary_ready");
    const startedAt = await serverNow();
    const child = startCanary("canary_ready", httpPort + 1);
    children.push(child);
    await waitForHttp(httpPort + 1);

    const live = await fetch(`http://127.0.0.1:${httpPort + 1}/health/live`);
    const ready = await fetch(`http://127.0.0.1:${httpPort + 1}/health/ready`);
    const estadisticas = await fetch(
      `http://127.0.0.1:${httpPort + 1}/api/v4/torneos/estadisticas`,
    );
    const proximos = await fetch(`http://127.0.0.1:${httpPort + 1}/api/v4/torneos/proximos`);
    const resumen = await fetch(
      `http://127.0.0.1:${httpPort + 1}/api/v4/torneos/${torneoId}/resumen`,
    );
    const canchas = await fetch(`http://127.0.0.1:${httpPort + 1}/canchas`);
    const jugadores = await fetch(`http://127.0.0.1:${httpPort + 1}/jugadores`);

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });
    expect(live.headers.get("x-api-version")).toBe("v4");
    expect(live.headers.get("x-api-track")).toBe("canary");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect(estadisticas.status).toBe(200);
    expect(await estadisticas.json()).toMatchObject({
      totalTorneos: 1,
      porDeporte: [{ deporte: "Ajedrez", cantidad: 1 }],
      porEstado: [{ estado: "PROGRAMADO", cantidad: 1 }],
    });
    expect(proximos.status).toBe(200);
    expect(await proximos.json()).toEqual([
      expect.objectContaining({
        id: torneoId,
        nombre: "Copa Desechable",
        fechaInicio: "2026-12-01",
        fechaFin: "2026-12-03",
      }),
    ]);
    expect(resumen.status).toBe(200);
    expect(await resumen.json()).toMatchObject({
      id: torneoId,
      nombre: "Copa Desechable",
      duracionDias: 3,
    });
    expect(canchas.status).toBe(200);
    expect(await canchas.json()).toEqual([
      expect.objectContaining({ nombre: "Cancha Norte", tipoSuperficie: "Madera" }),
    ]);
    expect(jugadores.status).toBe(200);
    expect(await jugadores.json()).toEqual([
      expect.objectContaining({ nombre: "Ana Prueba", documento: "DOC-100" }),
    ]);

    expect(await schemaFingerprint("canary_ready")).toEqual(before);
    const logged = await statementsBy("sports_boot", startedAt);
    expect(logged.some((statement) => statement.includes("WHERE 0 = 1"))).toBe(true);
    expect(logged.filter(isDdl)).toEqual([]);

    child.kill();
    await waitForExit(child);
  }, 60_000);
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

async function createDatabase(name: string): Promise<void> {
  const root = await rootConnection();
  await root.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await root.query(`CREATE DATABASE \`${name}\``);
  await root.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO 'sports_boot'@'%'`);
  await root.query("FLUSH PRIVILEGES");
  await root.end();
}

async function rootConnection(database?: string): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: "127.0.0.1",
    port,
    user: "root",
    password: rootPassword,
    database,
    multipleStatements: false,
    dateStrings: true,
  });
}

async function tableNames(database: string): Promise<string[]> {
  const connection = await rootConnection();
  const [rows] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [database],
  );
  await connection.end();
  return (rows as { name: string }[]).map((row) => row.name);
}

async function schemaFingerprint(database: string): Promise<unknown> {
  const connection = await rootConnection();
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const [indexes] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  await connection.end();
  return { columns, indexes };
}

async function serverNow(): Promise<string> {
  const connection = await rootConnection();
  const [rows] = await connection.query("SELECT NOW(6) AS now");
  await connection.end();
  return String((rows as { now: string }[])[0]?.now);
}

async function statementsBy(user: string, startedAt: string): Promise<string[]> {
  const connection = await rootConnection();
  const [rows] = await connection.query(
    `SELECT argument FROM mysql.general_log
     WHERE user_host LIKE ? AND event_time >= ?
     ORDER BY event_time`,
    [`%${user}%`, startedAt],
  );
  await connection.end();
  return (rows as { argument: string | Buffer }[]).map((row) => String(row.argument).trim());
}

function isDdl(statement: string): boolean {
  return /^(create|alter|drop|truncate|rename)\b/i.test(statement);
}

function startCanary(database: string, listenPort: number): ChildProcess {
  const env = { ...process.env };
  delete env.CLOUD_SQL_CONNECTION_NAME;
  delete env.DB_PASSWORD_FILE;
  env.DB_HOST = "127.0.0.1";
  env.DB_PORT = String(port);
  env.DB_USER = "sports_boot";
  env.DB_PASSWORD = password;
  env.DB_NAME = database;
  env.PORT = String(listenPort);
  env.API_VERSION = "v4";
  env.API_TRACK = "canary";

  return spawn(process.execPath, ["dist/index.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runCanary(
  database: string,
  listenPort: number,
): Promise<{ code: number | null; output: string }> {
  const child = startCanary(database, listenPort);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  const code = await waitForExit(child);
  return { code, output };
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("el proceso de Canary no terminó"));
    }, 20_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForHttp(listenPort: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${listenPort}/health/live`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError instanceof Error ? lastError : new Error("HTTP no quedó disponible");
}
