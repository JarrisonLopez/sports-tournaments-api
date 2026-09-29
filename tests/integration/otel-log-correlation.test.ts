import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { SpanKind, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { shutdownTracing, startTracing } from "../../src/instrumentation";

const BUSINESS_TRACE_ID = "trace-negocio";

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

describe("Correlación de logs con OpenTelemetry en Sports", () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  it("copia el SERVER span al child logger sin reemplazar traceId", async () => {
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
      const response = await fetch(`${baseUrl}/api/v2/flujo/abc/1/2`, {
        headers: {
          "x-trace-id": BUSINESS_TRACE_ID,
        },
      });

      expect(response.status).toBe(400);
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

      const petition = logs.entries.find(
        (entry) => entry.msg === "Petición API V2",
      );
      const completed = logs.entries.find(
        (entry) => entry.msg === "request completed",
      );
      const incoming = logs.entries.find(
        (entry) => entry.msg === "incoming request",
      );

      expect(petition).toMatchObject({
        traceId: BUSINESS_TRACE_ID,
        otelTraceId: serverTraceId,
        otelSpanId: serverSpanId,
      });
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
