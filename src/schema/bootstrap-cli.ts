import mysql from "mysql2/promise";

import {
  adoptBootstrap,
  applyBootstrap,
  assertBootstrapTarget,
  assertConfirmed,
  BootstrapPartialError,
  BootstrapRejectedError,
  planBootstrap,
  redactSecrets,
  targetFromEnv,
  type SqlClient,
} from "./bootstrap";

export async function executeBootstrapCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  log: (line: string) => void = console.log,
): Promise<number> {
  const command = argv[0];
  const confirmIndex = argv.indexOf("--confirm");
  const confirm = confirmIndex >= 0 ? argv[confirmIndex + 1] : undefined;
  const target = targetFromEnv(env, confirm);
  const password = target.password;

  if (command !== "plan" && command !== "apply" && command !== "adopt") {
    log("uso: plan | apply --confirm BASE | adopt --confirm BASE");
    return 1;
  }

  let connection: mysql.Connection | undefined;

  try {
    assertBootstrapTarget(target);

    if (target.expectedInstance) {
      // Declaración del operador. No comprueba la instancia detrás del proxy.
      log(`instanciaEsperada=${target.expectedInstance}`);
    }

    if (command !== "plan") {
      assertConfirmed(target);
    }

    connection = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: target.user,
      password,
      database: target.database,
      multipleStatements: false,
    });
    const client: SqlClient = {
      async query<T extends Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<T[]> {
        const [rows] = await connection!.query(sql, params ? [...params] : []);
        return (Array.isArray(rows) ? rows : []) as T[];
      },
    };

    if (command === "plan") {
      const plan = await planBootstrap(client, target);
      log(`accion=${plan.action}`);

      for (const reason of plan.reasons) {
        log(`motivo=${reason}`);
      }

      for (const statement of plan.statements) {
        log(statement);
      }

      return plan.action === "incompatible" ? 1 : 0;
    }

    const finished =
      command === "apply"
        ? await applyBootstrap(client, target)
        : await adoptBootstrap(client, target);
    log(`accion=${finished.action}`);
    return 0;
  } catch (error) {
    const message =
      error instanceof BootstrapRejectedError || error instanceof BootstrapPartialError
        ? error.message
        : error instanceof Error
          ? error.message
          : "falló el bootstrap";
    log(redactSecrets(message, [password]));
    return 1;
  } finally {
    await connection?.end();
  }
}

if (process.argv[1]?.includes("bootstrap-cli")) {
  executeBootstrapCommand(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "falló el bootstrap";
      console.error(redactSecrets(message, []));
      process.exitCode = 1;
    });
}
