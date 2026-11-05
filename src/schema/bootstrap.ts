import { resolveDbPassword } from "../config/db-password";
import {
  APPLICATION_DDL,
  APPLICATION_TABLES,
  applicationChecksum,
  BOOTSTRAP_VERSION,
  EXPECTED_APP_TABLES,
  EXPECTED_HISTORY_TABLE,
  HISTORY_DDL,
  HISTORY_INSERT,
  HISTORY_TABLE,
  type ColumnExpectation,
  type IndexExpectation,
  type TableExpectation,
} from "./canonical-schema";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_SQL =
  /\b(drop|truncate|alter|rename|delete|update|grant|revoke|replace|insert|call|load|outfile|dumpfile)\b/i;
const INSTANCE_COMPONENT = /^[a-z](?:[a-z0-9-]{0,96}[a-z0-9])?$/;

export class BootstrapRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapRejectedError";
  }
}

export class BootstrapPartialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapPartialError";
  }
}

export type SqlClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
};

export type BootstrapTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  allowHost: string;
  confirmDatabase?: string;
  cloudSqlConnectionName?: string;
  expectedInstance?: string;
};

export type ColumnSnapshot = ColumnExpectation & {
  charset: string | null;
  collation: string | null;
};

export type TableSnapshot = {
  name: string;
  engine: string;
  columns: ColumnSnapshot[];
  indexes: IndexExpectation[];
};

export type SchemaSnapshot = {
  database: string;
  defaultCharset: string;
  defaultCollation: string;
  tables: TableSnapshot[];
  foreignKeys: { table: string; column: string; referencedTable: string }[];
  history: { version: string; checksum: string }[];
};

export type BootstrapAction =
  | "apply"
  | "already-applied"
  | "adoption-required"
  | "incompatible";

export type BootstrapPlan = {
  action: BootstrapAction;
  reasons: string[];
  statements: readonly string[];
};

export function targetFromEnv(
  env: NodeJS.ProcessEnv,
  confirmDatabase?: string,
): BootstrapTarget {
  return {
    host: env.DB_HOST?.trim() ?? "",
    port: Number(env.DB_PORT),
    user: env.DB_USER?.trim() ?? "",
    password: resolveDbPassword(env) ?? "",
    database: env.DB_NAME?.trim() ?? "",
    allowHost: env.DB_BOOTSTRAP_ALLOW_HOST?.trim() ?? "",
    confirmDatabase,
    cloudSqlConnectionName: env.CLOUD_SQL_CONNECTION_NAME,
    expectedInstance: declaredInstance(env.DB_BOOTSTRAP_EXPECT_INSTANCE),
  };
}

function declaredInstance(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  return value;
}

export function assertBootstrapTarget(target: BootstrapTarget): void {
  if (target.cloudSqlConnectionName?.trim()) {
    throw new BootstrapRejectedError(
      "CLOUD_SQL_CONNECTION_NAME está definido; el bootstrap no se conecta a Cloud SQL",
    );
  }

  if (!target.host || target.host !== target.allowHost) {
    throw new BootstrapRejectedError(
      "DB_HOST debe coincidir con DB_BOOTSTRAP_ALLOW_HOST",
    );
  }

  const host = target.host.toLowerCase();

  if (
    host.includes("/") ||
    host.includes("\\") ||
    host.includes("cloudsql") ||
    host.endsWith("googleapis.com") ||
    host === "0.0.0.0"
  ) {
    throw new BootstrapRejectedError("el host de destino no está permitido");
  }

  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new BootstrapRejectedError("DB_PORT no es un puerto válido");
  }

  if (!target.user || !IDENTIFIER.test(target.database)) {
    throw new BootstrapRejectedError("DB_USER o DB_NAME no son válidos");
  }

  if (!target.password) {
    throw new BootstrapRejectedError("falta la contraseña de la base desechable");
  }

  // ALLOW_HOST solo compara el host TCP declarado.
  // EXPECT_INSTANCE solo declara proyecto:region:instancia.
  // Ninguna de las dos inspecciona el destino remoto del Cloud SQL Auth Proxy.
  // El workflow de GCP, cuando exista, deberá exigir un valor no vacío y comprobar
  // por su cuenta el destino del Auth Proxy. Debe fallar si no coinciden la
  // configuración, los metadatos de la instancia y el argumento de arranque.
  assertExpectedInstance(target.expectedInstance);
}

export function assertExpectedInstance(value: string | undefined): void {
  if (value === undefined || value === "") {
    return;
  }

  const parts = value.split(":");
  const declared =
    parts.length === 3 &&
    parts.every(
      (part) => INSTANCE_COMPONENT.test(part) && !part.includes("--"),
    );

  if (!declared) {
    throw new BootstrapRejectedError(
      "DB_BOOTSTRAP_EXPECT_INSTANCE debe ser proyecto:region:instancia; solo declara el destino previsto",
    );
  }
}

export function assertConfirmed(target: BootstrapTarget): void {
  if (target.confirmDatabase !== target.database) {
    throw new BootstrapRejectedError(
      "falta --confirm con el nombre exacto de la base de destino",
    );
  }
}

export function assertStatementSafe(sql: string): void {
  const trimmed = sql.trim();

  if (/if\s+not\s+exists/i.test(trimmed)) {
    throw new BootstrapRejectedError(
      "CREATE TABLE IF NOT EXISTS no está permitido",
    );
  }

  if (!trimmed.startsWith("CREATE TABLE `")) {
    throw new BootstrapRejectedError("solo se permiten sentencias CREATE TABLE auditadas");
  }

  if (FORBIDDEN_SQL.test(trimmed) || trimmed.includes(";")) {
    throw new BootstrapRejectedError("la sentencia contiene SQL no permitido");
  }
}

export function redactSecrets(message: string, secrets: readonly string[]): string {
  let output = message;

  for (const secret of secrets) {
    if (secret) {
      output = output.split(secret).join("[redacted]");
    }
  }

  return output;
}

export async function loadSnapshot(
  client: SqlClient,
  database: string,
): Promise<SchemaSnapshot> {
  const schemaRows = await client.query<{
    DEFAULT_CHARACTER_SET_NAME: string;
    DEFAULT_COLLATION_NAME: string;
  }>(
    `SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
     FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME = ?`,
    [database],
  );

  const schema = schemaRows[0];

  if (!schema) {
    throw new BootstrapRejectedError("la base de destino no existe");
  }

  const tableRows = await client.query<{ TABLE_NAME: string; ENGINE: string | null }>(
    `SELECT TABLE_NAME, ENGINE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [database],
  );
  const columnRows = await client.query<{
    TABLE_NAME: string;
    COLUMN_NAME: string;
    COLUMN_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
    EXTRA: string | null;
    CHARACTER_SET_NAME: string | null;
    COLLATION_NAME: string | null;
  }>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
            EXTRA, CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const indexRows = await client.query<{
    TABLE_NAME: string;
    INDEX_NAME: string;
    NON_UNIQUE: number;
    SEQ_IN_INDEX: number;
    COLUMN_NAME: string;
  }>(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  const foreignKeyRows = await client.query<{
    TABLE_NAME: string;
    COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string;
  }>(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY TABLE_NAME, COLUMN_NAME`,
    [database],
  );

  const tables = tableRows.map((row) => {
    const name = String(row.TABLE_NAME);

    return {
      name,
      engine: row.ENGINE ? String(row.ENGINE) : "",
      columns: columnRows
        .filter((column) => String(column.TABLE_NAME) === name)
        .map((column) => ({
          name: String(column.COLUMN_NAME),
          columnType: String(column.COLUMN_TYPE),
          nullable: column.IS_NULLABLE === "YES",
          defaultValue:
            column.COLUMN_DEFAULT === null || column.COLUMN_DEFAULT === undefined
              ? null
              : String(column.COLUMN_DEFAULT),
          extra: column.EXTRA ? String(column.EXTRA) : "",
          charset: column.CHARACTER_SET_NAME ? String(column.CHARACTER_SET_NAME) : null,
          collation: column.COLLATION_NAME ? String(column.COLLATION_NAME) : null,
          textual: column.CHARACTER_SET_NAME !== null && column.CHARACTER_SET_NAME !== undefined,
        })),
      indexes: groupIndexes(
        indexRows.filter((index) => String(index.TABLE_NAME) === name),
      ),
    };
  });

  const names = new Set(tables.map((table) => table.name));
  const history = names.has(HISTORY_TABLE)
    ? (
        await client.query<{ version: string; checksum: string }>(
          "SELECT `version`, `checksum` FROM `schema_bootstrap_history` ORDER BY `version`",
        )
      ).map((row) => ({
        version: String(row.version),
        checksum: String(row.checksum),
      }))
    : [];

  return {
    database,
    defaultCharset: String(schema.DEFAULT_CHARACTER_SET_NAME),
    defaultCollation: String(schema.DEFAULT_COLLATION_NAME),
    tables,
    foreignKeys: foreignKeyRows.map((row) => ({
      table: String(row.TABLE_NAME),
      column: String(row.COLUMN_NAME),
      referencedTable: String(row.REFERENCED_TABLE_NAME),
    })),
    history,
  };
}

export function classifySnapshot(snapshot: SchemaSnapshot): BootstrapPlan {
  const reasons: string[] = [];

  if (snapshot.foreignKeys.length > 0) {
    reasons.push("hay claves foráneas que las entidades no declaran");
  }

  const historyTable = snapshot.tables.find((table) => table.name === HISTORY_TABLE);
  const appTables = snapshot.tables.filter((table) => table.name !== HISTORY_TABLE);
  const unexpected = appTables.filter(
    (table) => !APPLICATION_TABLES.includes(table.name as (typeof APPLICATION_TABLES)[number]),
  );

  if (unexpected.length > 0) {
    reasons.push(
      `tablas no esperadas: ${unexpected.map((table) => table.name).join(", ")}`,
    );
  }

  const missing = APPLICATION_TABLES.filter(
    (name) => !appTables.some((table) => table.name === name),
  );

  if (appTables.length > 0 && missing.length > 0) {
    reasons.push(`faltan tablas: ${missing.join(", ")}`);
  }

  for (const expected of EXPECTED_APP_TABLES) {
    const actual = appTables.find((table) => table.name === expected.name);

    if (actual) {
      reasons.push(...diffTable(actual, expected, snapshot));
    }
  }

  if (reasons.length > 0) {
    return { action: "incompatible", reasons, statements: [] };
  }

  if (appTables.length === 0 && !historyTable) {
    return {
      action: "apply",
      reasons: [],
      statements: APPLICATION_DDL,
    };
  }

  if (appTables.length === 0 && historyTable) {
    return {
      action: "incompatible",
      reasons: ["el historial existe sin las tablas de aplicación"],
      statements: [],
    };
  }

  if (!historyTable) {
    return {
      action: "adoption-required",
      reasons: [
        "el esquema coincide con las entidades y no tiene historial; la adopción no se aplica sola",
      ],
      statements: [],
    };
  }

  reasons.push(...diffTable(historyTable, EXPECTED_HISTORY_TABLE, snapshot));

  const checksum = applicationChecksum();
  const current = snapshot.history.filter((row) => row.version === BOOTSTRAP_VERSION);

  if (snapshot.history.length !== 1 || current.length !== 1) {
    reasons.push("el historial no contiene exactamente la versión 001-initial");
  } else if (current[0]?.checksum !== checksum) {
    reasons.push("el checksum del historial no coincide con el DDL versionado");
  }

  if (reasons.length > 0) {
    return { action: "incompatible", reasons, statements: [] };
  }

  return { action: "already-applied", reasons: [], statements: [] };
}

export async function planBootstrap(
  client: SqlClient,
  target: BootstrapTarget,
): Promise<BootstrapPlan> {
  assertBootstrapTarget(target);
  const snapshot = await loadSnapshot(client, target.database);
  return classifySnapshot(snapshot);
}

export async function applyBootstrap(
  client: SqlClient,
  target: BootstrapTarget,
): Promise<BootstrapPlan> {
  assertBootstrapTarget(target);
  assertConfirmed(target);
  const plan = await planBootstrap(client, target);

  if (plan.action === "already-applied") {
    return plan;
  }

  if (plan.action !== "apply") {
    throw new BootstrapRejectedError(plan.reasons.join("; ") || "estado no aplicable");
  }

  try {
    for (const statement of APPLICATION_DDL) {
      assertStatementSafe(statement);
      await client.query(statement);
    }

    const created = await loadSnapshot(client, target.database);

    if (!appTablesMatch(created)) {
      throw new BootstrapPartialError(
        "las tablas creadas no coinciden con el DDL auditado; el DDL de MySQL ya confirmado no se revierte",
      );
    }

    assertStatementSafe(HISTORY_DDL);
    await client.query(HISTORY_DDL);
    await client.query(HISTORY_INSERT, [BOOTSTRAP_VERSION, applicationChecksum()]);
  } catch (error) {
    if (error instanceof BootstrapRejectedError || error instanceof BootstrapPartialError) {
      throw error;
    }

    throw new BootstrapPartialError(
      redactSecrets(
        error instanceof Error ? error.message : "falló la ejecución del bootstrap",
        [target.password],
      ) + "; el DDL de MySQL ya confirmado no se revierte",
    );
  }

  const finished = classifySnapshot(await loadSnapshot(client, target.database));

  if (finished.action !== "already-applied") {
    throw new BootstrapPartialError(
      `${finished.reasons.join("; ")}; el DDL de MySQL ya confirmado no se revierte`,
    );
  }

  return finished;
}

export async function adoptBootstrap(
  client: SqlClient,
  target: BootstrapTarget,
): Promise<BootstrapPlan> {
  assertBootstrapTarget(target);
  assertConfirmed(target);
  const before = await loadSnapshot(client, target.database);
  const plan = classifySnapshot(before);

  if (plan.action !== "adoption-required") {
    throw new BootstrapRejectedError(
      plan.reasons.join("; ") || "la base no está en estado de adopción",
    );
  }

  const fingerprint = JSON.stringify(before.tables);

  try {
    assertStatementSafe(HISTORY_DDL);
    await client.query(HISTORY_DDL);
    await client.query(HISTORY_INSERT, [BOOTSTRAP_VERSION, applicationChecksum()]);
  } catch (error) {
    if (error instanceof BootstrapRejectedError || error instanceof BootstrapPartialError) {
      throw error;
    }

    throw new BootstrapPartialError(
      redactSecrets(
        error instanceof Error ? error.message : "falló la adopción del historial",
        [target.password],
      ),
    );
  }

  const after = await loadSnapshot(client, target.database);
  const appAfter = after.tables.filter((table) => table.name !== HISTORY_TABLE);

  if (JSON.stringify(appAfter) !== fingerprint) {
    throw new BootstrapPartialError(
      "la adopción modificó tablas de aplicación; no se continúa",
    );
  }

  const finished = classifySnapshot(after);

  if (finished.action !== "already-applied") {
    throw new BootstrapPartialError(finished.reasons.join("; "));
  }

  return finished;
}

function appTablesMatch(snapshot: SchemaSnapshot): boolean {
  const reasons: string[] = [];
  const appTables = snapshot.tables.filter((table) => table.name !== HISTORY_TABLE);

  if (appTables.length !== EXPECTED_APP_TABLES.length || snapshot.foreignKeys.length > 0) {
    return false;
  }

  for (const expected of EXPECTED_APP_TABLES) {
    const actual = appTables.find((table) => table.name === expected.name);

    if (!actual) {
      return false;
    }

    reasons.push(...diffTable(actual, expected, snapshot));
  }

  return reasons.length === 0 && !snapshot.tables.some((table) => table.name === HISTORY_TABLE);
}

function diffTable(
  actual: TableSnapshot,
  expected: TableExpectation,
  snapshot: SchemaSnapshot,
): string[] {
  const reasons: string[] = [];

  if (actual.engine !== "InnoDB") {
    reasons.push(`${expected.name}: engine distinto de InnoDB`);
  }

  if (actual.columns.length !== expected.columns.length) {
    reasons.push(`${expected.name}: cantidad de columnas distinta`);
  }

  expected.columns.forEach((column, index) => {
    const found = actual.columns[index];

    if (!found || found.name !== column.name) {
      reasons.push(`${expected.name}: columna ${column.name} ausente o desordenada`);
      return;
    }

    if (
      found.columnType !== column.columnType ||
      found.nullable !== column.nullable ||
      found.defaultValue !== column.defaultValue ||
      found.extra !== column.extra
    ) {
      reasons.push(`${expected.name}.${column.name}: tipo, nulabilidad, default o extra distinto`);
    }

    if (column.textual) {
      if (
        found.charset !== snapshot.defaultCharset ||
        found.collation !== snapshot.defaultCollation
      ) {
        reasons.push(
          `${expected.name}.${column.name}: la collation no hereda el default de la base`,
        );
      }
    }
  });

  const actualIndexes = [...actual.indexes].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const expectedIndexes = [...expected.indexes].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    reasons.push(`${expected.name}: índices distintos`);
  }

  return reasons;
}

function groupIndexes(
  rows: {
    INDEX_NAME: string;
    NON_UNIQUE: number;
    SEQ_IN_INDEX: number;
    COLUMN_NAME: string;
  }[],
): IndexExpectation[] {
  const grouped = new Map<string, { unique: boolean; columns: { seq: number; name: string }[] }>();

  for (const row of rows) {
    const name = String(row.INDEX_NAME);
    const current = grouped.get(name) ?? {
      unique: Number(row.NON_UNIQUE) === 0,
      columns: [],
    };
    current.columns.push({
      seq: Number(row.SEQ_IN_INDEX),
      name: String(row.COLUMN_NAME),
    });
    grouped.set(name, current);
  }

  return [...grouped.entries()].map(([name, index]) => ({
    name,
    unique: index.unique,
    columns: index.columns
      .sort((left, right) => left.seq - right.seq)
      .map((column) => column.name),
  }));
}
