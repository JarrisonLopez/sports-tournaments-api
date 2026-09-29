import { createServer, type Server } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpanKind, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NoopSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const mocks = vi.hoisted(() => {
  const save = vi.fn();
  const download = vi.fn();
  const file = vi.fn(() => ({ save, download }));
  const bucket = vi.fn(() => ({ file }));

  return { save, download, file, bucket };
});

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class {
      bucket(bucketName: string) {
        return mocks.bucket(bucketName);
      }
    },
  };
});

import {
  resolveSpanProcessors,
  shutdownTracing,
  startTracing,
  startTracingOnImport,
} from "../../src/instrumentation";

const INVALID_TRACE_ID = "00000000000000000000000000000000";
const DEFAULT_OTLP_PORT = 4318;
const BUSINESS_TRACE_ID = "trace-negocio";

const artifact = {
  traceId: BUSINESS_TRACE_ID,
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

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
  spanId?: string;
  parentSpanId?: string;
  kind?: number;
  attributes?: OtlpKeyValue[];
};

type OtlpPayload = {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpKeyValue[] };
    scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
  }>;
};

type ExportedSpan = {
  serviceName: string | undefined;
  span: OtlpSpan;
};

const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const originalTracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const originalBucket = process.env.GCS_BUCKET_NAME;

describe("Exportación OTLP de trazas en Object Storage", () => {
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  afterEach(async () => {
    mocks.save.mockReset();
    mocks.download.mockReset();
    mocks.file.mockReset();
    mocks.bucket.mockReset();
    mocks.file.mockImplementation(() => ({
      save: mocks.save,
      download: mocks.download,
    }));
    mocks.bucket.mockImplementation(() => ({
      file: mocks.file,
    }));

    await shutdownTracing();
    restoreEnv("OTEL_EXPORTER_OTLP_ENDPOINT", originalEndpoint);
    restoreEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", originalTracesEndpoint);
    restoreEnv("GCS_BUCKET_NAME", originalBucket);
  });

  it("no inicia el SDK al importar cuando NODE_ENV es test", () => {
    expect(process.env.NODE_ENV).toBe("test");

    startTracingOnImport({ NODE_ENV: "test" });

    const span = trace
      .getTracer("object-storage-test")
      .startSpan("import-omitido");

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

    const connects = captureConnects();

    try {
      startTracing();

      const span = trace.getTracer("object-storage").startSpan("sin-exportar");
      span.end();
      await shutdownTracing();

      expect(
        connects.attempts.filter((attempt) => attempt.endsWith(`:${DEFAULT_OTLP_PORT}`)),
      ).toEqual([]);
    } finally {
      connects.restore();
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

  it("normaliza el endpoint con y sin barra final hacia /v1/traces", async () => {
    for (const suffix of ["", "/"]) {
      const receiver = await listen(0);
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${receiver.origin}${suffix}`;

      try {
        startTracing();

        const span = trace.getTracer("object-storage").startSpan("normalizacion");
        span.end();
        await shutdownTracing();

        expect(receiver.requests).toHaveLength(1);
        expect(receiver.requests[0]?.path).toBe("/v1/traces");
        expect(receiver.requests[0]?.path.includes("//")).toBe(false);

        const exported = allSpans(parsePayload(receiver.requests[0]?.body ?? ""));

        expect(exported).toHaveLength(1);
        expect(exported[0]?.serviceName).toBe("object-storage");
      } finally {
        await shutdownTracing();
        await receiver.close();
      }
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

      const span = trace.getTracer("object-storage").startSpan("solo-memoria");
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

  it("exporta SERVER y gcs.upload con el mismo trace y sin duplicados", async () => {
    const receiver = await listen(0);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.origin;
    process.env.GCS_BUCKET_NAME = "test-bucket";
    mocks.save.mockResolvedValue(undefined);

    const processors = resolveSpanProcessors();
    expect(processors).toHaveLength(1);
    expect(processors[0]).toBeInstanceOf(BatchSpanProcessor);
    await processors[0]?.shutdown();

    const { buildApp } = await import("../../src/app");
    const app = buildApp({ logger: false });

    try {
      startTracing();

      const baseUrl = await listenApp(app);
      const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": BUSINESS_TRACE_ID,
        },
        body: JSON.stringify(artifact),
      });

      expect(response.status).toBe(201);
      await response.arrayBuffer();
      await app.close();
      await shutdownTracing();

      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0]?.path).toBe("/v1/traces");
      expect(receiver.requests[0]?.contentType).toContain("application/json");

      const spans = allSpans(parsePayload(receiver.requests[0]?.body ?? ""));
      const server = oneSpan(spans, "POST /api/v2/artifacts");
      const upload = oneSpan(spans, "gcs.upload");

      expect(spans).toHaveLength(2);
      expect(server.serviceName).toBe("object-storage");
      expect(upload.serviceName).toBe("object-storage");
      expect(server.span.kind).toBe(SpanKind.SERVER + 1);
      expect(upload.span.kind).toBe(SpanKind.CLIENT + 1);
      expect(server.span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(upload.span.traceId).toBe(server.span.traceId);
      expect(upload.span.parentSpanId).toBe(server.span.spanId);
      expect(stringAttribute(upload.span, "gcs.operation")).toBe("upload");
    } finally {
      await closeApp(app);
      await receiver.close();
    }
  }, 20_000);

  it("exporta SERVER y gcs.download con el mismo trace y sin duplicados", async () => {
    const receiver = await listen(0);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.origin;
    process.env.GCS_BUCKET_NAME = "test-bucket";
    mocks.download.mockResolvedValue([Buffer.from(JSON.stringify(artifact))]);

    const { buildApp } = await import("../../src/app");
    const app = buildApp({ logger: false });

    try {
      startTracing();

      const baseUrl = await listenApp(app);
      const response = await fetch(
        `${baseUrl}/api/v2/artifacts/${BUSINESS_TRACE_ID}`,
        {
          headers: {
            "x-trace-id": BUSINESS_TRACE_ID,
          },
        },
      );

      expect(response.status).toBe(200);
      await response.arrayBuffer();
      await app.close();
      await shutdownTracing();

      const spans = allSpans(parsePayload(receiver.requests[0]?.body ?? ""));
      const server = oneSpan(spans, "GET /api/v2/artifacts/:traceId");
      const download = oneSpan(spans, "gcs.download");

      expect(receiver.requests).toHaveLength(1);
      expect(spans).toHaveLength(2);
      expect(server.serviceName).toBe("object-storage");
      expect(download.serviceName).toBe("object-storage");
      expect(download.span.kind).toBe(SpanKind.CLIENT + 1);
      expect(download.span.traceId).toBe(server.span.traceId);
      expect(download.span.parentSpanId).toBe(server.span.spanId);
      expect(stringAttribute(download.span, "gcs.operation")).toBe("download");
    } finally {
      await closeApp(app);
      await receiver.close();
    }
  }, 20_000);
});

function oneSpan(spans: ExportedSpan[], name: string): ExportedSpan {
  const matches = spans.filter((item) => item.span.name === name);

  expect(matches).toHaveLength(1);

  const match = matches[0];

  if (!match) {
    throw new Error(`Falta el span ${name}`);
  }

  return match;
}

function stringAttribute(span: OtlpSpan, key: string): string | undefined {
  return span.attributes?.find((attribute) => attribute.key === key)?.value
    ?.stringValue;
}

function parsePayload(body: string): OtlpPayload {
  return JSON.parse(body) as OtlpPayload;
}

function allSpans(payload: OtlpPayload): ExportedSpan[] {
  const found: ExportedSpan[] = [];

  for (const resourceSpan of payload.resourceSpans ?? []) {
    const serviceName = resourceSpan.resource?.attributes?.find(
      (attribute) => attribute.key === "service.name",
    )?.value?.stringValue;

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        found.push({ serviceName, span });
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
