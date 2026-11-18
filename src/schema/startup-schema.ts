import "reflect-metadata";
import { getMetadataArgsStorage } from "typeorm";

import { Cancha } from "../entities/Cancha";
import { Jugador } from "../entities/Jugador";
import { Torneo } from "../entities/Torneo";

const REQUIRED_TABLES = [
  { target: Torneo, name: "torneos" },
  { target: Cancha, name: "canchas" },
  { target: Jugador, name: "jugadores" },
] as const;

export class StartupSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupSchemaError";
  }
}

export type StartupQuery = (sql: string) => Promise<unknown>;

export function startupSchemaStatements(): readonly string[] {
  return REQUIRED_TABLES.map(({ target, name }) => {
    const columns = columnNames(target);
    const projected = columns.map(quoteIdentifier).join(", ");

    return `SELECT ${projected} FROM ${quoteIdentifier(name)} WHERE 0 = 1`;
  });
}

export async function assertStartupSchema(query: StartupQuery): Promise<void> {
  const statements = startupSchemaStatements();

  for (let index = 0; index < REQUIRED_TABLES.length; index += 1) {
    const table = REQUIRED_TABLES[index]?.name;
    const sql = statements[index];

    if (!table || !sql) {
      throw new StartupSchemaError("No se pudo comprobar el esquema de arranque");
    }

    try {
      await query(sql);
    } catch (error) {
      if (error instanceof StartupSchemaError) {
        throw error;
      }

      throw new StartupSchemaError(describeSchemaFailure(table, error));
    }
  }
}

function columnNames(target: Function): string[] {
  const columns = getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName);

  if (columns.length === 0) {
    throw new StartupSchemaError("No se pudo comprobar el esquema de arranque");
  }

  return columns;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new StartupSchemaError("No se pudo comprobar el esquema de arranque");
  }

  return `\`${identifier}\``;
}

function describeSchemaFailure(table: string, error: unknown): string {
  const errno = readErrno(error);
  const driverMessage = readDriverMessage(error);

  if (errno === 1146 || /doesn't exist/i.test(driverMessage)) {
    return `Falta la tabla requerida: ${table}`;
  }

  if (errno === 1054 || /Unknown column/i.test(driverMessage)) {
    const match = driverMessage.match(/Unknown column '([^']+)'/u);
    const column = match?.[1]?.split(".").pop();
    const allowed = new Set(columnNames(tableTarget(table)));

    if (column && allowed.has(column)) {
      return `Falta la columna requerida: ${table}.${column}`;
    }

    return `Falta una columna requerida en ${table}`;
  }

  return `No se pudo comprobar el esquema de ${table}`;
}

function tableTarget(table: string): Function {
  const found = REQUIRED_TABLES.find((entry) => entry.name === table);

  if (!found) {
    throw new StartupSchemaError("No se pudo comprobar el esquema de arranque");
  }

  return found.target;
}

function readErrno(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const record = error as {
    errno?: unknown;
    driverError?: { errno?: unknown };
  };
  const errno = record.driverError?.errno ?? record.errno;

  return typeof errno === "number" ? errno : undefined;
}

function readDriverMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const record = error as {
    message?: unknown;
    driverError?: { message?: unknown };
  };
  const message = record.driverError?.message ?? record.message;

  return typeof message === "string" ? message : "";
}
