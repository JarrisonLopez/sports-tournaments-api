import { afterEach, describe, expect, it } from "vitest";
import { SpanKind, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { shutdownTracing, startTracing } from "../../src/instrumentation";

const ARTIFACT_TEMPLATE = "GET /api/v2/artifacts/:traceId";

async function flushSpans(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };

  await provider.getDelegate?.()?.forceFlush?.();
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El servidor no expuso un puerto TCP");
  }

  return `http://127.0.0.1:${address.port}`;
}

function serverSpans(exporter: InMemorySpanExporter): ReadableSpan[] {
  return exporter
    .getFinishedSpans()
    .filter((span) => span.kind === SpanKind.SERVER);
}

describe("Spans HTTP servidor de Object Storage", () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  it("crea un SERVER span con la plantilla de ruta", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const { buildApp } = await import("../../src/app");
    const app = buildApp({ logger: false });

    try {
      const baseUrl = await listen(app);
      const response = await fetch(`${baseUrl}/api/v2/artifacts/trace-1`, {
        headers: {
          "x-trace-id": "otro-trace",
        },
      });

      expect(response.status).toBe(400);
      await response.arrayBuffer();
      await flushSpans();
      await exporter.forceFlush();

      const spans = serverSpans(exporter);

      expect(spans).toHaveLength(1);
      expect(spans[0]?.name).toBe(ARTIFACT_TEMPLATE);
      expect(spans[0]?.attributes["http.route"]).toBe(
        "/api/v2/artifacts/:traceId",
      );
      expect(spans[0]?.name).not.toContain("trace-1");
      expect(String(spans[0]?.attributes["http.route"])).not.toContain(
        "trace-1",
      );
      expect(spans[0]?.resource.attributes["service.name"]).toBe(
        "object-storage",
      );
    } finally {
      await app.close();
    }
  });

  it("no crea un SERVER span para /health/live", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const { buildApp } = await import("../../src/app");
    const app = buildApp({ logger: false });

    try {
      const baseUrl = await listen(app);
      const response = await fetch(`${baseUrl}/health/live`);

      expect(response.status).toBe(200);
      await response.arrayBuffer();
      await flushSpans();
      await exporter.forceFlush();

      expect(serverSpans(exporter)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("no duplica el span SERVER al reiniciar el SDK", async () => {
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });

      try {
        const baseUrl = await listen(app);
        const response = await fetch(`${baseUrl}/api/v2/artifacts/trace-1`);
        await response.arrayBuffer();
        await flushSpans();
        await exporter.forceFlush();

        expect(serverSpans(exporter)).toHaveLength(1);
        expect(serverSpans(exporter)[0]?.name).toBe(ARTIFACT_TEMPLATE);
      } finally {
        await app.close();
        await shutdownTracing();
      }
    }
  });
});
