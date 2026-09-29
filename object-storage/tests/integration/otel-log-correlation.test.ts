import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpanKind, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  InMemorySpanExporter,
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

import { shutdownTracing, startTracing } from "../../src/instrumentation";

const BUSINESS_TRACE_ID = "trace-negocio";

const artifact = {
  traceId: BUSINESS_TRACE_ID,
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

type LogEntry = Record<string, unknown>;

async function flushSpans(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };

  await provider.getDelegate?.()?.forceFlush?.();
}

function captureLogs(): { stream: Writable; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  let buffered = "";

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") {
          continue;
        }

        entries.push(JSON.parse(line) as LogEntry);
      }

      callback();
    },
  });

  return { stream, entries };
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El servidor no expuso un puerto TCP");
  }

  return `http://127.0.0.1:${address.port}`;
}

describe("Correlación de logs con OpenTelemetry en Object Storage", () => {
  const originalBucket = process.env.GCS_BUCKET_NAME;

  afterEach(async () => {
    mocks.save.mockReset();
    mocks.download.mockReset();
    mocks.file.mockReset();
    mocks.bucket.mockReset();

    if (originalBucket === undefined) {
      delete process.env.GCS_BUCKET_NAME;
    } else {
      process.env.GCS_BUCKET_NAME = originalBucket;
    }

    await shutdownTracing();
  });

  it("copia el SERVER span al child logger sin reemplazar traceId", async () => {
    mocks.file.mockImplementation(() => ({
      save: mocks.save,
      download: mocks.download,
    }));
    mocks.bucket.mockImplementation(() => ({
      file: mocks.file,
    }));
    mocks.save.mockResolvedValue(undefined);
    process.env.GCS_BUCKET_NAME = "test-bucket";

    const exporter = new InMemorySpanExporter();
    const logs = captureLogs();

    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const { buildApp } = await import("../../src/app");
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    let closed = false;

    const closeApp = async () => {
      if (closed) {
        return;
      }

      closed = true;
      await app.close();
    };

    try {
      const baseUrl = await listen(app);
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
      await closeApp();
      await flushSpans();
      await exporter.forceFlush();

      const serverSpans = exporter
        .getFinishedSpans()
        .filter((span) => span.kind === SpanKind.SERVER);

      expect(serverSpans).toHaveLength(1);

      const serverSpan = serverSpans[0] as ReadableSpan;
      const serverTraceId = serverSpan.spanContext().traceId;
      const serverSpanId = serverSpan.spanContext().spanId;

      expect(BUSINESS_TRACE_ID).not.toBe(serverTraceId);

      const completed = logs.entries.find(
        (entry) => entry.msg === "request completed",
      );
      const incoming = logs.entries.find(
        (entry) => entry.msg === "incoming request",
      );

      expect(completed).toMatchObject({
        traceId: BUSINESS_TRACE_ID,
        otelTraceId: serverTraceId,
        otelSpanId: serverSpanId,
      });
      expect(incoming).not.toHaveProperty("traceId");
      expect(incoming).not.toHaveProperty("otelTraceId");
      expect(incoming).not.toHaveProperty("otelSpanId");
    } finally {
      await closeApp();
    }
  }, 20_000);
});
