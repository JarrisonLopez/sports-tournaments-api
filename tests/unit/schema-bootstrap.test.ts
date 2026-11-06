import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  APPLICATION_DDL,
  applicationChecksum,
  BOOTSTRAP_VERSION,
  DOCUMENTO_UNIQUE_INDEX,
  EXPECTED_APP_TABLES,
  EXPECTED_HISTORY_TABLE,
  HISTORY_TABLE,
} from "../../src/schema/canonical-schema";
import { executeBootstrapCommand } from "../../src/schema/bootstrap-cli";
import {
  adoptBootstrap,
  applyBootstrap,
  assertBootstrapTarget,
  assertExpectedInstance,
  assertStatementSafe,
  BootstrapPartialError,
  BootstrapRejectedError,
  classifySnapshot,
  clearDeploymentWithoutHistory,
  planBootstrap,
  redactSecrets,
  targetFromEnv,
  type SchemaSnapshot,
  type SqlClient,
  type TableSnapshot,
} from "../../src/schema/bootstrap";

const defaults = {
  charset: "utf8mb4",
  collation: "utf8mb4_0900_ai_ci",
};

function tableSnapshot(
  expected: (typeof EXPECTED_APP_TABLES)[number] | typeof EXPECTED_HISTORY_TABLE,
): TableSnapshot {
  return {
    name: expected.name,
    engine: "InnoDB",
    columns: expected.columns.map((column) => ({
      ...column,
      charset: column.textual ? defaults.charset : null,
      collation: column.textual ? defaults.collation : null,
    })),
    indexes: expected.indexes.map((index) => ({ ...index, columns: [...index.columns] })),
  };
}

function snapshot(options: {
  tables: TableSnapshot[];
  history?: { version: string; checksum: string }[];
  foreignKeys?: SchemaSnapshot["foreignKeys"];
}): SchemaSnapshot {
  return {
    database: "sports_bootstrap_empty",
    defaultCharset: defaults.charset,
    defaultCollation: defaults.collation,
    tables: options.tables,
    foreignKeys: options.foreignKeys ?? [],
    history: options.history ?? [],
  };
}

function appSnapshot(): SchemaSnapshot {
  return snapshot({
    tables: EXPECTED_APP_TABLES.map((table) => tableSnapshot(table)),
  });
}

function appliedSnapshot(): SchemaSnapshot {
  return snapshot({
    tables: [
      ...EXPECTED_APP_TABLES.map((table) => tableSnapshot(table)),
      tableSnapshot(EXPECTED_HISTORY_TABLE),
    ],
    history: [{ version: BOOTSTRAP_VERSION, checksum: applicationChecksum() }],
  });
}

function target(confirm?: string) {
  return targetFromEnv(
    {
      DB_HOST: "127.0.0.1",
      DB_PORT: "33066",
      DB_USER: "sports_boot",
      DB_PASSWORD: "local-secret",
      DB_NAME: "sports_bootstrap_empty",
      DB_BOOTSTRAP_ALLOW_HOST: "127.0.0.1",
    },
    confirm,
  );
}

describe("bootstrap de esquema", () => {
  it("rechaza Cloud SQL, host distinto y SQL destructivo", () => {
    expect(() =>
      assertBootstrapTarget({
        ...target(),
        cloudSqlConnectionName: "proyecto:region:instancia",
      }),
    ).toThrow(/Cloud SQL/);
    expect(() =>
      assertBootstrapTarget({
        ...target(),
        host: "10.0.0.8",
      }),
    ).toThrow(/DB_BOOTSTRAP_ALLOW_HOST/);
    expect(() => assertStatementSafe("DROP TABLE `torneos`")).toThrow(BootstrapRejectedError);
    expect(() =>
      assertStatementSafe("CREATE TABLE IF NOT EXISTS `torneos` (id int)"),
    ).toThrow(/IF NOT EXISTS/);

    for (const statement of APPLICATION_DDL) {
      expect(() => assertStatementSafe(statement)).not.toThrow();
    }
  });

  it("clasifica vacía, aplicada, adopción e incompatible", () => {
    expect(classifySnapshot(snapshot({ tables: [] })).action).toBe("apply");
    expect(classifySnapshot(appliedSnapshot()).action).toBe("already-applied");
    expect(classifySnapshot(appSnapshot()).action).toBe("adoption-required");
    const compatible = classifySnapshot(appSnapshot());
    expect(clearDeploymentWithoutHistory(compatible, "")).toBe("blocked");
    expect(clearDeploymentWithoutHistory(compatible, "ADOPT:sports_db")).toBe("blocked");
    expect(
      clearDeploymentWithoutHistory(compatible, "SCHEMA-COMPATIBLE:sports_db"),
    ).toBe("readonly-compatible");
    expect(compatible.action).toBe("adoption-required");
    expect(compatible.statements).toEqual([]);
    expect(
      clearDeploymentWithoutHistory(
        classifySnapshot(appliedSnapshot()),
        "SCHEMA-COMPATIBLE:sports_db",
      ),
    ).toBe("recorded");
    expect(
      classifySnapshot(
        snapshot({
          tables: [
            ...appSnapshot().tables,
            {
              name: "otra",
              engine: "InnoDB",
              columns: [],
              indexes: [],
            },
          ],
        }),
      ).action,
    ).toBe("incompatible");
    const drifted = appSnapshot();
    drifted.tables[2]!.columns[5]!.columnType = "varchar(10)";
    expect(classifySnapshot(drifted).action).toBe("incompatible");
  });

  it("no aplica sin confirmación y no toca una base incompatible", async () => {
    const client = recordingClient(appliedSnapshot());
    await expect(applyBootstrap(client, target())).rejects.toBeInstanceOf(
      BootstrapRejectedError,
    );
    expect(client.queries).toEqual([]);

    const incompatible = recordingClient(
      snapshot({
        tables: [{ name: "legacy", engine: "InnoDB", columns: [], indexes: [] }],
      }),
    );
    await expect(applyBootstrap(incompatible, target("sports_bootstrap_empty"))).rejects.toThrow(
      /legacy/,
    );
    expect(incompatible.queries.some((sql) => sql.startsWith("CREATE"))).toBe(false);
    expect(incompatible.queries.some((sql) => /drop|truncate/i.test(sql))).toBe(false);
  });

  it("crea el esquema vacío, lo deja registrado y no lo recrea", async () => {
    const client = mutableClient();
    const created = await applyBootstrap(client, target("sports_bootstrap_empty"));
    expect(created.action).toBe("already-applied");
    expect(client.queries.filter((sql) => sql.startsWith("CREATE TABLE"))).toHaveLength(4);
    expect(client.queries.some((sql) => /drop|truncate|alter/i.test(sql))).toBe(false);

    const before = client.queries.length;
    const repeated = await applyBootstrap(client, target("sports_bootstrap_empty"));
    expect(repeated.action).toBe("already-applied");
    expect(client.queries.slice(before).some((sql) => sql.startsWith("CREATE"))).toBe(false);
  });

  it("adopta un esquema ya creado sin volver a crear las tablas de aplicación", async () => {
    const client = mutableClient("synchronized");
    await expect(applyBootstrap(client, target("sports_bootstrap_empty"))).rejects.toThrow(
      /adopción no se aplica sola/,
    );
    expect(client.queries.some((sql) => sql.startsWith("CREATE TABLE `torneos`"))).toBe(false);

    const adopted = await adoptBootstrap(client, target("sports_bootstrap_empty"));
    expect(adopted.action).toBe("already-applied");
    expect(client.queries.filter((sql) => sql.startsWith("CREATE TABLE"))).toEqual([
      expect.stringContaining("schema_bootstrap_history"),
    ]);
  });

  it("si una sentencia falla, no envía DROP y oculta la contraseña", async () => {
    const client = mutableClient();
    client.failOn = "CREATE TABLE `jugadores`";
    client.failure = new Error("denied for local-secret at socket");

    await expect(applyBootstrap(client, target("sports_bootstrap_empty"))).rejects.toThrow(
      /\[redacted\]/,
    );
    expect(client.failure).toBeInstanceOf(Error);
    expect(client.queries.some((sql) => /drop|truncate/i.test(sql))).toBe(false);
    expect(redactSecrets("local-secret visible", ["local-secret"])).toBe("[redacted] visible");
  });

  it("el índice versionado es el que emitió TypeORM y el runtime no cambia", () => {
    expect(APPLICATION_DDL[1]).toContain(DOCUMENTO_UNIQUE_INDEX);
    expect(APPLICATION_DDL.join("\n")).not.toMatch(/drop|truncate|alter/i);
    expect(readFileSync("src/config/database.ts", "utf8")).toContain("synchronize: false");
    expect(readFileSync("src/index.ts", "utf8")).not.toContain("schema/bootstrap");
    expect(classifySnapshot(appliedSnapshot()).statements).toEqual([]);
  });

  it("rechaza host y confirmación antes de abrir una conexión", async () => {
    const lines: string[] = [];
    const mismatched = await executeBootstrapCommand(
      ["plan"],
      {
        DB_HOST: "127.0.0.1",
        DB_PORT: "1",
        DB_USER: "sports_boot",
        DB_PASSWORD: "local-secret",
        DB_NAME: "sports_bootstrap_empty",
        DB_BOOTSTRAP_ALLOW_HOST: "10.0.0.8",
      },
      (line) => lines.push(line),
    );
    expect(mismatched).toBe(1);
    expect(lines.join("\n")).toMatch(/DB_BOOTSTRAP_ALLOW_HOST/);
    expect(lines.join("\n")).not.toContain("local-secret");

    const unconfirmed: string[] = [];
    const missingConfirm = await executeBootstrapCommand(
      ["apply"],
      {
        DB_HOST: "127.0.0.1",
        DB_PORT: "1",
        DB_USER: "sports_boot",
        DB_PASSWORD: "local-secret",
        DB_NAME: "sports_bootstrap_empty",
        DB_BOOTSTRAP_ALLOW_HOST: "127.0.0.1",
      },
      (line) => unconfirmed.push(line),
    );
    expect(missingConfirm).toBe(1);
    expect(unconfirmed.join("\n")).toMatch(/--confirm/);
    expect(unconfirmed.join("\n")).not.toContain("local-secret");
  });

  it("plan no ejecuta DDL", async () => {
    const client = mutableClient();
    const plan = await planBootstrap(client, target());
    expect(plan.action).toBe("apply");
    expect(plan.statements).toEqual(APPLICATION_DDL);
    expect(client.queries.some((sql) => sql.startsWith("CREATE"))).toBe(false);
  });

  it("declara una instancia con formato válido y no la trata como verificada", async () => {
    const declared = "proyecto:us-central1:sports-demo-mysql";
    const lines: string[] = [];
    const code = await executeBootstrapCommand(
      ["plan"],
      localEnv({ DB_BOOTSTRAP_EXPECT_INSTANCE: declared, DB_PORT: "1" }),
      (line) => lines.push(line),
    );
    const output = lines.join("\n");

    expect(code).toBe(1);
    expect(output).toContain(`instanciaEsperada=${declared}`);
    expect(output).not.toMatch(/instanciaVerificada|instanciaAutenticada/);
    expect(output).not.toContain("local-secret");
    expect(targetFromEnv(localEnv({ DB_BOOTSTRAP_EXPECT_INSTANCE: declared })).expectedInstance).toBe(
      declared,
    );
  });

  it("rechaza formatos de instancia incompletos, extra o con caracteres de control", () => {
    const rejected = [
      "proyecto:sports-demo-mysql",
      "proyecto::sports-demo-mysql",
      ":us-central1:sports-demo-mysql",
      "proyecto:us-central1",
      "proyecto:us-central1:",
      "proyecto:us-central1:sports-demo-mysql:extra",
      "proyecto: us-central1:sports-demo-mysql",
      "proyecto:us-central1:sports-demo-mysql ",
      "proyecto:us-central1:sports-demo-mysql\n",
      "proyecto:us-central1:sports-demo-mysql\r",
      "proyecto:us-central1:sports-demo-mysql\t",
      "proyecto:us-central1:sports-\u0001demo",
    ];

    for (const value of rejected) {
      expect(() => assertExpectedInstance(value)).toThrow(
        /proyecto:region:instancia/,
      );
    }

    expect(() => assertExpectedInstance(undefined)).not.toThrow();
    expect(() => assertExpectedInstance("")).not.toThrow();
  });

  it("en local omite la declaración y conserva plan, confirmaciones, historial y checksum", async () => {
    expect(targetFromEnv(localEnv()).expectedInstance).toBeUndefined();
    expect(() => assertBootstrapTarget(targetFromEnv(localEnv()))).not.toThrow();

    const client = mutableClient();
    const plan = await planBootstrap(client, targetFromEnv(localEnv()));
    expect(plan.action).toBe("apply");
    expect(client.queries.some((sql) => sql.startsWith("CREATE"))).toBe(false);
    expect(client.queries.some((sql) => /drop|truncate|alter/i.test(sql))).toBe(false);

    const declared = targetFromEnv(localEnv({ DB_BOOTSTRAP_EXPECT_INSTANCE: "proyecto:us-central1:sports-demo-mysql" }));
    await expect(applyBootstrap(client, declared)).rejects.toThrow(/--confirm/);
    await expect(adoptBootstrap(mutableClient("synchronized"), declared)).rejects.toThrow(/--confirm/);
    expect(client.queries.some((sql) => sql.startsWith("CREATE"))).toBe(false);

    const confirmed = targetFromEnv(
      localEnv({ DB_BOOTSTRAP_EXPECT_INSTANCE: "proyecto:us-central1:sports-demo-mysql" }),
      "sports_bootstrap_empty",
    );
    const applied = await applyBootstrap(mutableClient(), confirmed);
    expect(applied.action).toBe("already-applied");
    expect(classifySnapshot(appliedSnapshot()).action).toBe("already-applied");
    expect(appliedSnapshot().history).toEqual([
      { version: BOOTSTRAP_VERSION, checksum: applicationChecksum() },
    ]);
  });

  it("rechaza la instancia malformada antes de conectar y sin imprimir la contraseña", async () => {
    const lines: string[] = [];
    const code = await executeBootstrapCommand(
      ["apply", "--confirm", "sports_bootstrap_empty"],
      localEnv({
        DB_PORT: "1",
        DB_BOOTSTRAP_EXPECT_INSTANCE: "local-secret\nproyecto:us-central1:instancia",
      }),
      (line) => lines.push(line),
    );
    const output = lines.join("\n");

    expect(code).toBe(1);
    expect(output).toMatch(/DB_BOOTSTRAP_EXPECT_INSTANCE/);
    expect(output).not.toContain("instanciaEsperada=");
    expect(output).not.toContain("local-secret");
    expect(output).not.toContain("accion=");
  });
});

function localEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DB_HOST: "127.0.0.1",
    DB_PORT: "33066",
    DB_USER: "sports_boot",
    DB_PASSWORD: "local-secret",
    DB_NAME: "sports_bootstrap_empty",
    DB_BOOTSTRAP_ALLOW_HOST: "127.0.0.1",
    ...overrides,
  };
}

function recordingClient(current: SchemaSnapshot): SqlClient & { queries: string[] } {
  return {
    queries: [],
    async query(sql: string) {
      this.queries.push(sql);
      return answer(sql, current) as Record<string, unknown>[];
    },
  };
}

function mutableClient(initial: "empty" | "synchronized" = "empty"): SqlClient & {
  queries: string[];
  failOn?: string;
  failure?: Error;
} {
  let state: SchemaSnapshot =
    initial === "synchronized" ? appSnapshot() : snapshot({ tables: [] });

  return {
    queries: [],
    async query(sql: string, params?: readonly unknown[]) {
      this.queries.push(sql);

      if (this.failOn && sql.startsWith(this.failOn)) {
        throw this.failure ?? new Error("fallo");
      }

      if (sql.startsWith("CREATE TABLE `canchas`")) {
        state = appSnapshot();
      }

      if (sql.startsWith("CREATE TABLE `schema_bootstrap_history`")) {
        state = {
          ...state,
          tables: [...state.tables.filter((table) => table.name !== HISTORY_TABLE), tableSnapshot(EXPECTED_HISTORY_TABLE)],
        };
      }

      if (sql.startsWith("INSERT INTO `schema_bootstrap_history`")) {
        state = {
          ...state,
          history: [
            {
              version: String(params?.[0]),
              checksum: String(params?.[1]),
            },
          ],
        };
      }

      return answer(sql, state) as Record<string, unknown>[];
    },
  };
}

function answer(sql: string, state: SchemaSnapshot): unknown[] {
  if (sql.includes("SCHEMATA")) {
    return [
      {
        DEFAULT_CHARACTER_SET_NAME: state.defaultCharset,
        DEFAULT_COLLATION_NAME: state.defaultCollation,
      },
    ];
  }

  if (sql.includes("information_schema.TABLES")) {
    return state.tables.map((table) => ({ TABLE_NAME: table.name, ENGINE: table.engine }));
  }

  if (sql.includes("information_schema.COLUMNS")) {
    return state.tables.flatMap((table) =>
      table.columns.map((column) => ({
        TABLE_NAME: table.name,
        COLUMN_NAME: column.name,
        COLUMN_TYPE: column.columnType,
        IS_NULLABLE: column.nullable ? "YES" : "NO",
        COLUMN_DEFAULT: column.defaultValue,
        EXTRA: column.extra,
        CHARACTER_SET_NAME: column.charset,
        COLLATION_NAME: column.collation,
      })),
    );
  }

  if (sql.includes("STATISTICS")) {
    return state.tables.flatMap((table) =>
      table.indexes.flatMap((index) =>
        index.columns.map((column, position) => ({
          TABLE_NAME: table.name,
          INDEX_NAME: index.name,
          NON_UNIQUE: index.unique ? 0 : 1,
          SEQ_IN_INDEX: position + 1,
          COLUMN_NAME: column,
        })),
      ),
    );
  }

  if (sql.includes("KEY_COLUMN_USAGE")) {
    return state.foreignKeys.map((key) => ({
      TABLE_NAME: key.table,
      COLUMN_NAME: key.column,
      REFERENCED_TABLE_NAME: key.referencedTable,
    }));
  }

  if (sql.includes("FROM `schema_bootstrap_history`")) {
    return state.history;
  }

  return [];
}
