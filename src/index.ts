import { DataSource } from "typeorm";

import { shutdownTracing } from "./instrumentation";
import { buildApp } from "./app";
import { closeCloudSqlConnector, openAppDataSource } from "./config/database";
import { bootApplication } from "./startup";

const app = buildApp();

let shutdownPromise: Promise<void> | undefined;
let dataSource: DataSource | undefined;

const start = async () => {
  try {
    dataSource = await openAppDataSource();
    await bootApplication(dataSource, async () => {
      app.log.info("Esquema de negocio comprobado");
      app.log.info("Base de datos conectada");
      await app.listen({
        port: Number(process.env.PORT) || 3000,
        host: "0.0.0.0",
      });
    });

    registerShutdownSignals();
  } catch (error) {
    app.log.error(error instanceof Error ? error.message : "falló el arranque");
    await releaseStartupResources();
    process.exit(1);
  }
};

async function releaseStartupResources(): Promise<void> {
  try {
    await app.close();
  } catch {
    // El servidor todavía no escuchaba.
  }

  if (dataSource?.isInitialized) {
    try {
      await dataSource.destroy();
    } catch {
      // La conexión ya se estaba cerrando.
    }
  }

  try {
    await closeCloudSqlConnector();
  } catch {
    // El arranque ya falló; el cierre no debe ocultar ese error.
  }
}

function registerShutdownSignals(): void {
  process.on("SIGTERM", () => {
    void shutdownOnce();
  });
  process.on("SIGINT", () => {
    void shutdownOnce();
  });
}

function shutdownOnce(): Promise<void> {
  if (!shutdownPromise) {
    shutdownPromise = shutdown();
  }

  return shutdownPromise;
}

async function shutdown(): Promise<void> {
  let failed = false;

  try {
    await app.close();
  } catch (error) {
    failed = true;
    app.log.error(error);
  }

  try {
    await shutdownTracing();
  } catch (error) {
    failed = true;
    app.log.error(error);
  }

  if (dataSource?.isInitialized) {
    try {
      await dataSource.destroy();
    } catch (error) {
      failed = true;
      app.log.error(error instanceof Error ? error.message : "falló el cierre de la base");
    }
  }

  try {
    await closeCloudSqlConnector();
  } catch (error) {
    failed = true;
    app.log.error(
      error instanceof Error ? error.message : "falló el cierre del conector de Cloud SQL",
    );
  }

  if (failed) {
    process.exitCode = 1;
    process.exit(1);
  }
}

start();
