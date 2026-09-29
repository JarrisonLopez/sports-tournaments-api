import { fork, type ChildProcess } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const BUSINESS_TRACE_ID = "distributed-business-trace";
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const SERVER_KIND = 1;
const CLIENT_KIND = 2;
const READY_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SPORTS_SERVER = "GET /api/v2/flujo/:torneoId/:habitacionId/:peliculaId";
const HOTEL_CLIENT = "GET /api/v2/habitacion/:id";
const CINE_CLIENT = "GET /api/v2/peliculas/:id";
const OBJECT_STORAGE_OPERATION = "POST /api/v2/artifacts";
const GCS_UPLOAD = "gcs.upload";

type SerializedSpan = {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  serviceName: string | null;
  "url.path": string | null;
  "http.route": string | null;
};

type IpcMessage = {
  type: string;
  pid?: number;
  port?: number;
  spans?: SerializedSpan[];
  traceparent?: string | null;
  traceId?: string | null;
  message?: string;
};

type ChildSession = {
  child: ChildProcess;
  spans: SerializedSpan[];
  headers: { traceparent: string | null; traceId: string | null };
  output: () => string;
};

describe("Tracing distribuido Sports -> Object Storage", () => {
  let hotelServer: Server | undefined;
  let cineServer: Server | undefined;
  let sportsSession: ChildSession | undefined;
  let storageSession: ChildSession | undefined;

  afterEach(async () => {
    await closeServer(hotelServer);
    await closeServer(cineServer);
    hotelServer = undefined;
    cineServer = undefined;
    await shutdownChild(sportsSession?.child);
    await shutdownChild(storageSession?.child);
    sportsSession = undefined;
    storageSession = undefined;
  });

  it(
    "une CLIENT y SERVER a través de traceparent en procesos distintos",
    async () => {
      storageSession = startChild(
        path.join(repoRoot, "tests", "fixtures", "object-storage-traced-process.cjs"),
        childEnv({ GCS_BUCKET_NAME: "test-bucket" }),
      );
      const storageReady = await waitForReady(storageSession);

      const hotelHeaders = captureHeaders();
      hotelServer = createJsonServer(hotelHeaders.store, {
        id: 7,
        numeroHabitacion: "101",
        precioHabitacion: 100,
        estadoHabitacion: "disponible",
        tipoHabitacion: "doble",
      });
      const hotelUrl = await listen(hotelServer);

      const cineHeaders = captureHeaders();
      cineServer = createJsonServer(cineHeaders.store, {
        id: 42,
        nombre: "Pelicula distribuida",
        duracion: 120,
        genero: "drama",
        descripcion: "Funcion local",
      });
      const cineUrl = await listen(cineServer);

      sportsSession = startChild(
        path.join(repoRoot, "tests", "fixtures", "sports-traced-process.cjs"),
        childEnv({
          HOTEL_API_URL: hotelUrl,
          CINE_API_URL: cineUrl,
          OBJECT_STORAGE_API_URL: `http://127.0.0.1:${storageReady.port}`,
        }),
      );
      const sportsReady = await waitForReady(sportsSession);

      const response = await fetch(
        `http://127.0.0.1:${sportsReady.port}/api/v2/flujo/1/7/42`,
        {
          headers: {
            "x-trace-id": BUSINESS_TRACE_ID,
            connection: "close",
          },
        },
      );
      const body = (await response.json()) as {
        traceId?: string;
        habitacion?: { id?: number };
        pelicula?: { id?: number };
        artifact?: { bucket?: string; object?: string };
      };

      const sportsShutdown = await shutdownChild(sportsSession.child);
      const storageShutdown = await shutdownChild(storageSession.child);

      expect(response.status, sportsSession.output()).toBe(200);
      expect(response.headers.get("x-trace-id")).toBe(BUSINESS_TRACE_ID);
      expect(body.traceId).toBe(BUSINESS_TRACE_ID);
      expect(body.habitacion?.id).toBe(7);
      expect(body.pelicula?.id).toBe(42);
      expect(body.artifact).toEqual({
        bucket: "test-bucket",
        object: "flujos/distributed-business-trace.json",
      });

      expect(sportsShutdown).toEqual({
        shutdownDone: true,
        exitCode: 0,
        killed: false,
      });
      expect(storageShutdown).toEqual({
        shutdownDone: true,
        exitCode: 0,
        killed: false,
      });

      expect(sportsReady.pid).not.toBe(storageReady.pid);
      expect(sportsReady.pid).not.toBe(process.pid);
      expect(storageReady.pid).not.toBe(process.pid);

      const sportsSpans = sportsSession.spans;
      const storageSpans = storageSession.spans;

      expect(sportsSpans).toHaveLength(4);
      expect(storageSpans).toHaveLength(2);

      const sportsServer = one(sportsSpans, SPORTS_SERVER, SERVER_KIND);
      const hotelClient = one(sportsSpans, HOTEL_CLIENT, CLIENT_KIND);
      const cineClient = one(sportsSpans, CINE_CLIENT, CLIENT_KIND);
      const storageClient = one(
        sportsSpans,
        OBJECT_STORAGE_OPERATION,
        CLIENT_KIND,
      );
      const storageServer = one(
        storageSpans,
        OBJECT_STORAGE_OPERATION,
        SERVER_KIND,
      );

      const traceId = sportsServer.traceId;

      expect(sportsServer.parentSpanId).toBeNull();
      expect(sportsServer.serviceName).toBe("sports-api");
      expect(sportsServer["http.route"]).toBe(
        "/api/v2/flujo/:torneoId/:habitacionId/:peliculaId",
      );

      expect(hotelClient.traceId).toBe(traceId);
      expect(hotelClient.parentSpanId).toBe(sportsServer.spanId);
      expect(hotelClient.serviceName).toBe("sports-api");
      expect(hotelClient["url.path"]).toBe("/api/v2/habitacion/7");

      expect(cineClient.traceId).toBe(traceId);
      expect(cineClient.parentSpanId).toBe(sportsServer.spanId);
      expect(cineClient.serviceName).toBe("sports-api");
      expect(cineClient["url.path"]).toBe("/api/v2/peliculas/42");

      expect(storageClient.traceId).toBe(traceId);
      expect(storageClient.parentSpanId).toBe(sportsServer.spanId);
      expect(storageClient.serviceName).toBe("sports-api");
      expect(storageClient["url.path"]).toBe("/api/v2/artifacts");

      expect(storageServer.traceId).toBe(traceId);
      expect(storageServer.parentSpanId).toBe(storageClient.spanId);
      expect(storageServer.serviceName).toBe("object-storage");
      expect(storageServer["http.route"]).toBe("/api/v2/artifacts");

      const gcsUpload = one(storageSpans, GCS_UPLOAD, CLIENT_KIND);

      expect(gcsUpload.traceId).toBe(traceId);
      expect(gcsUpload.parentSpanId).toBe(storageServer.spanId);
      expect(gcsUpload.serviceName).toBe("object-storage");

      const hotelTrace = parseTraceparent(hotelHeaders.store.traceparent);
      const cineTrace = parseTraceparent(cineHeaders.store.traceparent);
      const storageTrace = parseTraceparent(storageSession.headers.traceparent);

      expect(hotelTrace.traceId).toBe(traceId);
      expect(hotelTrace.parentId).toBe(hotelClient.spanId);
      expect(cineTrace.traceId).toBe(traceId);
      expect(cineTrace.parentId).toBe(cineClient.spanId);
      expect(storageTrace.traceId).toBe(traceId);
      expect(storageTrace.parentId).toBe(storageClient.spanId);

      expect(hotelHeaders.store.traceId).toBe(BUSINESS_TRACE_ID);
      expect(cineHeaders.store.traceId).toBe(BUSINESS_TRACE_ID);
      expect(storageSession.headers.traceId).toBe(BUSINESS_TRACE_ID);
      expect(BUSINESS_TRACE_ID).not.toBe(traceId);
    },
    20_000,
  );
});

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH,
  };

  for (const key of ["SystemRoot", "SYSTEMROOT", "PATHEXT", "TEMP", "TMP", "windir"]) {
    const value = process.env[key];

    if (value) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...extra,
  };
}

function startChild(script: string, env: NodeJS.ProcessEnv): ChildSession {
  const child = fork(script, [], {
    cwd: repoRoot,
    env,
    execPath: process.execPath,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const session: ChildSession = {
    child,
    spans: [],
    headers: {
      traceparent: null,
      traceId: null,
    },
    output: () => "",
  };
  let output = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    output += chunk;
  });
  child.on("message", (message: IpcMessage) => {
    if (message.type === "spans" && message.spans) {
      session.spans.push(...message.spans);
    }

    if (message.type === "headers") {
      session.headers = {
        traceparent: message.traceparent ?? null,
        traceId: message.traceId ?? null,
      };
    }
  });
  child.on("error", () => {
    output += "\nchild error event";
  });
  session.output = () => output;

  return session;
}

function waitForReady(
  session: ChildSession,
): Promise<{ pid: number; port: number }> {
  const { child } = session;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`ready timeout\n${session.output()}`));
    }, READY_TIMEOUT_MS);

    const onMessage = (message: IpcMessage) => {
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.message ?? session.output()));
        return;
      }

      if (message.type === "ready" && message.pid && message.port) {
        cleanup();
        resolve({
          pid: message.pid,
          port: message.port,
        });
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `el hijo terminó antes de ready code=${code} signal=${signal}\n${session.output()}`,
        ),
      );
    };

    function cleanup() {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    }

    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function shutdownChild(child: ChildProcess | undefined): Promise<{
  shutdownDone: boolean;
  exitCode: number | null;
  killed: boolean;
}> {
  if (!child) {
    return {
      shutdownDone: false,
      exitCode: null,
      killed: false,
    };
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      shutdownDone: false,
      exitCode: child.exitCode,
      killed: child.signalCode !== null,
    };
  }

  let shutdownDone = false;
  let exited = false;
  const onMessage = (message: IpcMessage) => {
    if (message.type === "shutdown-done") {
      shutdownDone = true;
    }
  };
  const onExit = () => {
    exited = true;
  };

  child.on("message", onMessage);
  child.once("exit", onExit);

  try {
    child.send({ type: "shutdown" });
  } catch {
    child.kill();
    await waitUntil(() => exited, SHUTDOWN_TIMEOUT_MS);
    child.off("message", onMessage);
    return {
      shutdownDone,
      exitCode: child.exitCode,
      killed: true,
    };
  }

  const acknowledged = await waitUntil(
    () => shutdownDone,
    SHUTDOWN_TIMEOUT_MS,
  );

  if (!acknowledged) {
    child.kill();
    await waitUntil(() => exited, SHUTDOWN_TIMEOUT_MS);
    child.off("message", onMessage);
    return {
      shutdownDone,
      exitCode: child.exitCode,
      killed: true,
    };
  }

  const finished = await waitUntil(() => exited, SHUTDOWN_TIMEOUT_MS);

  if (!finished) {
    child.kill();
    await waitUntil(() => exited, SHUTDOWN_TIMEOUT_MS);
    child.off("message", onMessage);
    return {
      shutdownDone,
      exitCode: child.exitCode,
      killed: true,
    };
  }

  child.off("message", onMessage);

  return {
    shutdownDone,
    exitCode: child.exitCode,
    killed: false,
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const started = Date.now();

  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) {
      return false;
    }

    await delay(20);
  }

  return true;
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function one(
  spans: SerializedSpan[],
  name: string,
  kind: number,
): SerializedSpan {
  const matches = spans.filter((span) => span.name === name && span.kind === kind);

  expect(matches).toHaveLength(1);

  const span = matches[0];

  if (!span) {
    throw new Error(`Falta el span ${name}`);
  }

  return span;
}

function parseTraceparent(value: string | null): {
  traceId: string;
  parentId: string;
} {
  expect(value).toMatch(TRACEPARENT);
  const match = TRACEPARENT.exec(value ?? "");

  return {
    traceId: match?.[1] ?? "",
    parentId: match?.[2] ?? "",
  };
}

function captureHeaders(): {
  store: { traceparent: string | null; traceId: string | null };
} {
  return {
    store: {
      traceparent: null,
      traceId: null,
    },
  };
}

function createJsonServer(
  captured: { traceparent: string | null; traceId: string | null },
  body: unknown,
): Server {
  return createServer((request, response) => {
    captured.traceparent = headerValue(request.headers, "traceparent");
    captured.traceId = headerValue(request.headers, "x-trace-id");
    response.writeHead(200, {
      "content-type": "application/json",
      connection: "close",
    });
    response.end(JSON.stringify(body));
  });
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("El stub no expuso un puerto TCP"));
        return;
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server || !server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
