"use strict";

process.env.NODE_ENV = "test";
process.env.GCS_BUCKET_NAME = "test-bucket";

const path = require("node:path");
const Module = require("node:module");
const { createRequire } = require("node:module");

const repoRoot = path.resolve(__dirname, "../..");

// Hook solo de este proceso hijo. No se restaura: el proceso es desechable
// y el padre de Vitest nunca instala Module._load.
const originalLoad = Module._load;

Module._load = function loadWithoutGoogleCloud(request, parent, isMain) {
  if (request === "@google-cloud/storage") {
    return {
      Storage: class Storage {
        bucket() {
          return {
            file() {
              return {
                save() {
                  return Promise.resolve();
                },
              };
            },
          };
        }
      },
    };
  }

  return originalLoad.apply(this, arguments);
};

const objectStorageRequire = createRequire(
  path.join(repoRoot, "object-storage", "package.json"),
);
const { startTracing, shutdownTracing } = objectStorageRequire(
  "./dist/instrumentation.js",
);
const { buildApp } = objectStorageRequire("./dist/app.js");
const { SimpleSpanProcessor } = objectStorageRequire(
  "@opentelemetry/sdk-trace-base",
);
const api = objectStorageRequire("@opentelemetry/api");
const { IpcSpanExporter } = require("./ipc-span.js");

const exporter = new IpcSpanExporter();

startTracing({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

const app = buildApp({ logger: false });

app.addHook("onRequest", async (request) => {
  const url = request.url.split("?")[0];

  if (request.method !== "POST" || url !== "/api/v2/artifacts") {
    return;
  }

  await send({
    type: "headers",
    traceparent: headerValue(request.headers.traceparent),
    traceId: headerValue(request.headers["x-trace-id"]),
  });
});

app.addHook("onSend", async (_request, reply) => {
  reply.header("connection", "close");
});

let shuttingDown = false;

function headerValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

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
      throw new Error("Object Storage no expuso un puerto TCP");
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
