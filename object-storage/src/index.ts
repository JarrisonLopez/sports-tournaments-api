import { shutdownTracing } from "./instrumentation";
import { buildApp } from "./app";

const app = buildApp();

let shutdownPromise: Promise<void> | undefined;

const start = async () => {
  try {
    await app.listen({
      port: Number(process.env.PORT) || 3000,
      host: "0.0.0.0",
    });

    registerShutdownSignals();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

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

  if (failed) {
    process.exitCode = 1;
    process.exit(1);
  }
}

start();
