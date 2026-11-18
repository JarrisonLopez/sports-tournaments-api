import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";

import { Torneo } from "../entities/Torneo";
import { Cancha } from "../entities/Cancha";
import { Jugador } from "../entities/Jugador";
import { resolveDbPassword } from "./db-password";

/**
 * MySQL 8.4 anuncia caching_sha2_password. La documentación de Cloud SQL
 * indica que el socket Unix del Auth Proxy no está soportado con ese plugin.
 * El volumen /cloudsql de Cloud Run usa ese socket y no se puede fijar a
 * Auth Proxy >= 2.19.0. El conector de Node abre TLS con la cuenta de
 * servicio (cloudsql.client) y mysql2 autentica con la contraseña de Secret
 * Manager. DB_HOST presente fuerza TCP local y no construye el conector.
 *
 * Esta ruta no se probó contra Cloud SQL real. El preflight de un SELECT 1
 * en la instancia es obligatorio antes del primer despliegue.
 */
const CONNECTION_NAME_PATTERN =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z][a-z0-9-]{0,30}[a-z0-9]:[a-z][a-z0-9-]{0,96}[a-z0-9]$/;

export type MysqlConnectionPlan =
  | { mode: "tcp"; host: string; port: number }
  | { mode: "cloud-sql-connector"; instanceConnectionName: string };

export type CloudSqlDriverOptions = {
  extra: Record<string, unknown>;
  close: () => Promise<void>;
};

export type CloudSqlLoader = (
  instanceConnectionName: string,
) => Promise<CloudSqlDriverOptions>;

export function planMysqlConnection(env: NodeJS.ProcessEnv): MysqlConnectionPlan {
  const host = env.DB_HOST?.trim() ?? "";

  if (host !== "") {
    return {
      mode: "tcp",
      host,
      port: Number(env.DB_PORT),
    };
  }

  const connectionName = env.CLOUD_SQL_CONNECTION_NAME?.trim() ?? "";

  if (connectionName === "") {
    return {
      mode: "tcp",
      host: "",
      port: Number(env.DB_PORT),
    };
  }

  if (!CONNECTION_NAME_PATTERN.test(connectionName)) {
    throw new Error(
      "CLOUD_SQL_CONNECTION_NAME debe ser proyecto:region:instancia. No se usa el socket Unix /cloudsql.",
    );
  }

  return {
    mode: "cloud-sql-connector",
    instanceConnectionName: connectionName,
  };
}

function createDataSource(
  env: NodeJS.ProcessEnv,
  extra: Record<string, unknown>,
  plan: MysqlConnectionPlan,
): DataSource {
  return new DataSource({
    type: "mysql",
    ...(plan.mode === "tcp"
      ? {
          host: plan.host,
          port: plan.port,
        }
      : {}),
    username: env.DB_USER,
    password: resolveDbPassword(env),
    database: env.DB_NAME,
    entities: [Torneo, Cancha, Jugador],
    // Literales fijos. Ninguna variable de entorno habilita estos modos.
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
    extra,
  });
}

function shellDataSource(): DataSource {
  return new DataSource({
    type: "mysql",
    host: "127.0.0.1",
    port: 1,
    username: "pending",
    database: "pending",
    entities: [Torneo, Cancha, Jugador],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
  });
}

function planKey(plan: MysqlConnectionPlan): string {
  return plan.mode === "tcp"
    ? `tcp:${plan.host}:${plan.port}`
    : `cloud-sql:${plan.instanceConnectionName}`;
}

const initialPlan = planMysqlConnection(process.env);
let openedKey = "";
let connectorClose: (() => Promise<void>) | undefined;

export let AppDataSource: DataSource;

if (initialPlan.mode === "tcp") {
  AppDataSource = createDataSource(process.env, {}, initialPlan);
  openedKey = planKey(initialPlan);
} else {
  AppDataSource = shellDataSource();
}

export async function loadCloudSqlDriverOptions(
  instanceConnectionName: string,
): Promise<CloudSqlDriverOptions> {
  if (process.env.VITEST === "true") {
    throw new Error(
      "El conector de Cloud SQL no se abre durante las pruebas. El preflight real queda fuera de este proceso.",
    );
  }

  const { AuthTypes, Connector, IpAddressTypes } = await import(
    "@google-cloud/cloud-sql-connector"
  );
  const connector = new Connector();

  try {
    const extra = await connector.getOptions({
      instanceConnectionName,
      // La instancia tiene IP pública y cero redes autorizadas. El conector
      // usa el certificado efímero de la cuenta de servicio, no una red abierta.
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
    });

    return {
      extra: extra as unknown as Record<string, unknown>,
      close: async () => {
        await connector.close();
      },
    };
  } catch (error) {
    await connector.close();
    const detail = error instanceof Error ? error.message : "error desconocido";
    throw new Error(`No se pudo preparar el conector de Cloud SQL: ${detail}`);
  }
}

export async function openAppDataSource(
  env: NodeJS.ProcessEnv = process.env,
  loader: CloudSqlLoader = loadCloudSqlDriverOptions,
): Promise<DataSource> {
  const plan = planMysqlConnection(env);
  const key = planKey(plan);

  if (openedKey === key) {
    return AppDataSource;
  }

  if (plan.mode === "tcp") {
    AppDataSource = createDataSource(env, {}, plan);
    openedKey = key;
    return AppDataSource;
  }

  const loaded = await loader(plan.instanceConnectionName);

  if (loaded.extra.socketPath) {
    await loaded.close();
    throw new Error(
      "El conector de Cloud SQL no debe configurarse con un socket Unix",
    );
  }

  AppDataSource = createDataSource(env, loaded.extra, plan);
  connectorClose = loaded.close;
  openedKey = key;
  return AppDataSource;
}

export async function closeCloudSqlConnector(): Promise<void> {
  const close = connectorClose;
  connectorClose = undefined;

  if (!close) {
    return;
  }

  openedKey = "";
  await close();
}
