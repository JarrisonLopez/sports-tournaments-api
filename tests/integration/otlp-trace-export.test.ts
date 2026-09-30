import { createServer, type Server } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanKind, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NoopSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { buildApp } from "../../src/app";
import {
  resolveSpanProcessors,
  shutdownTracing,
  startTracing,
  startTracingOnImport,
} from "../../src/instrumentation";

const INVALID_TRACE_ID = "00000000000000000000000000000000";
const SERVER_SPAN_NAME = "GET /api/v2/otlp-export";
const DEFAULT_OTLP_PORT = 4318;

type CapturedRequest = {
  path: string;
  body: string;
  contentType: string | undefined;
};

type OtlpKeyValue = {
  key?: string;
  value?: { stringValue?: string };
};

type OtlpSpan = {
  name?: string;
  traceId?: string;
  kind?: number;
};

type OtlpPayload = {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpKeyValue[] };
    scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
  }>;
};

const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const originalTracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

describe("Exportación OTLP de trazas en Sports", () => {
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  afterEach(async () => {
    await shutdownTracing();
    restoreEnv("OTEL_EXPORTER_OTLP_ENDPOINT", originalEndpoint);
    restoreEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", originalTracesEndpoint);
  });

  it("no inicia el SDK al importar cuando NODE_ENV es test", () => {
    expect(process.env.NODE_ENV).toBe("test");

    startTracingOnImport({ NODE_ENV: "test" });

    const span = trace.getTracer("sports-api-test").startSpan("import-omitido");

    expect(span.spanContext().traceId).toBe(INVALID_TRACE_ID);
    span.end();
  });

  it("sin endpoint usa NoopSpanProcessor y no contacta localhost:4318", async () => {
    const processors = resolveSpanProcessors();

    expect(processors).toHaveLength(1);
    expect(processors[0]).toBeInstanceOf(NoopSpanProcessor);

    const tracesOnly = resolveSpanProcessors(
      {},
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:9" },
    );

    expect(tracesOnly[0]).toBeInstanceOf(NoopSpanProcessor);

    const probe = await listen(DEFAULT_OTLP_PORT);
    const connects = captureConnects();

    try {
      startTracing();

      const span = trace.getTracer("sports-api").startSpan("sin-exportar");
      span.end();
      await shutdownTracing();

      expect(probe.requests).toEqual([]);
      expect(connects.attempts).toEqual([]);
    } finally {
      connects.restore();
      await probe.close();
    }
  });

  it("trata el endpoint vacío o inválido como ausente", () => {
    for (const endpoint of ["", "   ", "no-es-una-url", "ftp://127.0.0.1/otlp"]) {
      const processors = resolveSpanProcessors(
        {},
        { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint },
      );

      expect(processors).toHaveLength(1);
      expect(processors[0]).toBeInstanceOf(NoopSpanProcessor);
    }
  });

  it("usa solo los spanProcessors explícitos aunque haya endpoint", async () => {
    const receiver = await listen(0);
    const memory = new InMemorySpanExporter();
    const explicit = [new SimpleSpanProcessor(memory)];

    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.origin;

    try {
      expect(resolveSpanProcessors({ spanProcessors: explicit })).toBe(explicit);

      startTracing({ spanProcessors: explicit });

      const span = trace.getTracer("sports-api").startSpan("solo-memoria");
      span.end();
      await memory.forceFlush();

      expect(memory.getFinishedSpans().map((item) => item.name)).toEqual([
        "solo-memoria",
      ]);

      await shutdownTracing();

      expect(receiver.requests).toEqual([]);
    } finally {
      await receiver.close();
    }
  });

  it("exporta el span SERVER a un receptor OTLP local", async () => {
    const receiver = await listen(0);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.origin;

    const processors = resolveSpanProcessors();
    expect(processors).toHaveLength(1);
    expect(processors[0]).toBeInstanceOf(BatchSpanProcessor);
    await processors[0]?.shutdown();

    const app = buildApp({ logger: false });
    app.get("/api/v2/otlp-export", async () => ({ ok: true }));

    try {
      startTracing();

      const baseUrl = await listenApp(app);
      const response = await fetch(`${baseUrl}/api/v2/otlp-export`);

      expect(response.status).toBe(200);
      await response.arrayBuffer();
      await app.close();
      await shutdownTracing();

      const traces = receiver.requests.filter(
        (request) => request.path === "/v1/traces",
      );

      expect(traces).toHaveLength(1);
      expect(traces[0]?.contentType).toContain("application/json");

      const payload = JSON.parse(traces[0]?.body ?? "") as OtlpPayload;
      const exported = spansNamed(payload, SERVER_SPAN_NAME);

      expect(exported).toHaveLength(1);
      expect(exported[0]?.span.kind).toBe(SpanKind.SERVER + 1);
      expect(exported[0]?.span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(exported[0]?.serviceName).toBe("sports-api");
    } finally {
      await closeApp(app);
      await receiver.close();
    }
  }, 20_000);
});

function spansNamed(
  payload: OtlpPayload,
  name: string,
): Array<{ serviceName: string | undefined; span: OtlpSpan }> {
  const found: Array<{ serviceName: string | undefined; span: OtlpSpan }> = [];

  for (const resourceSpan of payload.resourceSpans ?? []) {
    const serviceName = resourceSpan.resource?.attributes?.find(
      (attribute) => attribute.key === "service.name",
    )?.value?.stringValue;

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        if (span.name === name) {
          found.push({ serviceName, span });
        }
      }
    }
  }

  return found;
}

async function closeApp(app: FastifyInstance): Promise<void> {
  try {
    await app.close();
  } catch {
    // El caso de éxito ya cerró Fastify antes del flush.
  }
}

async function listenApp(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El servidor no expuso un puerto TCP");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function listen(port = 0): Promise<{
  origin: string;
  port: number;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: headerValue(request.headers["content-type"]),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    if (port === 0) {
      server.listen(0, "127.0.0.1", () => resolve());
      return;
    }

    server.listen(port, "localhost", () => resolve());
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El receptor OTLP no expuso un puerto TCP");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    close: () => closeServer(server),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();

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

function captureConnects(): { attempts: string[]; restore: () => void } {
  const attempts: string[] = [];
  const original = Socket.prototype.connect;

  Socket.prototype.connect = function connect(
    this: Socket,
    ...args: Parameters<Socket["connect"]>
  ): Socket {
    attempts.push(connectTarget(args[0]));
    return original.apply(this, args);
  } as Socket["connect"];

  return {
    attempts,
    restore() {
      Socket.prototype.connect = original;
    },
  };
}

function connectTarget(target: Parameters<Socket["connect"]>[0]): string {
  if (typeof target === "object" && target !== null && "port" in target) {
    const host =
      "host" in target
        ? target.host
        : "hostname" in target
          ? target.hostname
          : "";

    return `${String(host ?? "")}:${String(target.port)}`;
  }

  return String(target);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
