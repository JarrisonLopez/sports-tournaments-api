"use strict";

process.env.NODE_ENV = "test";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createRequire } = require("node:module");

const repoRoot = path.resolve(__dirname, "../..");
const torneoServicePath = fs.realpathSync(
  path.join(repoRoot, "dist", "services", "torneo.service.js"),
);

// Hook solo de este proceso hijo. No se restaura: el proceso es desechable
// y el padre de Vitest nunca instala Module._load.
const originalLoad = Module._load;

Module._load = function loadWithoutTorneoDatabase(request, parent, isMain) {
  if (isTorneoServiceModule(request, parent, isMain)) {
    return {
      async buscarPorId(id) {
        return {
          id,
          nombre: "Copa distribuida",
          deporte: "futbol",
          fechaInicio: "2026-01-01",
          fechaFin: "2026-01-02",
          estado: "PROGRAMADO",
        };
      },
    };
  }

  return originalLoad.apply(this, arguments);
};

function isTorneoServiceModule(request, parent, isMain) {
  try {
    const resolved = Module._resolveFilename(request, parent, isMain);
    return fs.realpathSync(resolved) === torneoServicePath;
  } catch {
    return false;
  }
}

const sportsRequire = createRequire(path.join(repoRoot, "package.json"));
const { startTracing, shutdownTracing } = sportsRequire(
  "./dist/instrumentation.js",
);
const { buildApp } = sportsRequire("./dist/app.js");
const { SimpleSpanProcessor } = sportsRequire("@opentelemetry/sdk-trace-base");
const api = sportsRequire("@opentelemetry/api");
const { IpcSpanExporter } = require("./ipc-span.js");

const exporter = new IpcSpanExporter();

startTracing({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

const app = buildApp({ logger: false });

app.addHook("onSend", async (_request, reply) => {
  reply.header("connection", "close");
});

let shuttingDown = false;

async function forceFlushSpans() {
  const provider = api.trace.getTracerProvider();

  if (typeof provider.getDelegate !== "function") {
    return;
  }

  const delegate = provider.getDelegate();

  if (delegate && typeof delegate.forceFlush === "function") {
    await delegate.forceFlush();
  }
}

function send(message) {
  return new Promise((resolve) => {
    if (typeof process.send !== "function" || !process.connected) {
      resolve();
      return;
    }

    process.send(message, () => resolve());
  });
}

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await app.close();
  await forceFlushSpans();
  await exporter.forceFlush();
  await shutdownTracing();
  await send({ type: "shutdown-done" });

  if (process.connected) {
    process.disconnect();
  }
}

process.on("message", (message) => {
  if (!message || message.type !== "shutdown") {
    return;
  }

  shutdown().catch(async (error) => {
    await send({
      type: "error",
      message: error instanceof Error ? error.stack ?? error.message : String(error),
    });

    if (process.connected) {
      process.disconnect();
    }
  });
});

app
  .listen({ port: 0, host: "127.0.0.1" })
  .then(async () => {
    const address = app.server.address();

    if (address === null || typeof address === "string") {
      throw new Error("Sports no expuso un puerto TCP");
    }

    await send({
      type: "ready",
      pid: process.pid,
      port: address.port,
    });
  })
  .catch(async (error) => {
    await send({
      type: "error",
      message: error instanceof Error ? error.stack ?? error.message : String(error),
    });

    if (process.connected) {
      process.disconnect();
    }
  });
