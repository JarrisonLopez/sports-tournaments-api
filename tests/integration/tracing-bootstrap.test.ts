import { afterEach, describe, expect, it, vi } from "vitest";
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { buildApp } from "../../src/app";
import {
  shutdownTracing,
  startTracing,
  startTracingOnImport,
} from "../../src/instrumentation";

const INVALID_TRACE_ID = "00000000000000000000000000000000";

async function flushActiveTracer(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };

  await provider.getDelegate?.()?.forceFlush?.();
}

describe("Bootstrap de tracing", () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  it("exporta un span manual y no registra un MeterProvider global", async () => {
    const exporter = new InMemorySpanExporter();
    const setGlobalMeterProvider = vi.spyOn(metrics, "setGlobalMeterProvider");

    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const span = trace.getTracer("sports-api-test").startSpan("manual-span");
    span.end();

    await flushActiveTracer();
    await exporter.forceFlush();

    const finished = exporter.getFinishedSpans();

    expect(finished).toHaveLength(1);
    expect(finished[0]?.name).toBe("manual-span");
    expect(finished[0]?.resource.attributes["service.name"]).toBe("sports-api");
    expect(setGlobalMeterProvider).not.toHaveBeenCalled();

    setGlobalMeterProvider.mockRestore();
  });

  it("inyecta traceparent W3C desde el span activo", () => {
    startTracing();

    const span = trace.getTracer("sports-api-test").startSpan("propagacion");
    const carrier: Record<string, string> = {};

    context.with(trace.setSpan(context.active(), span), () => {
      propagation.inject(context.active(), carrier, {
        set(target, key, value) {
          target[key] = value;
        },
      });
    });

    span.end();

    expect(carrier.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );
  });

  it("arranca sin exporter y sigue pudiendo construir la app", async () => {
    startTracing();

    const span = trace.getTracer("sports-api-test").startSpan("proceso");
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanContext().traceId).not.toBe(INVALID_TRACE_ID);
    span.end();

    const app = buildApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("no arranca al importar en test y sí fuera de test", () => {
    startTracingOnImport({ NODE_ENV: "test" });

    const skipped = trace.getTracer("sports-api-test").startSpan("omitido");
    expect(skipped.spanContext().traceId).toBe(INVALID_TRACE_ID);
    skipped.end();

    startTracingOnImport({ NODE_ENV: "production" });

    const created = trace.getTracer("sports-api-test").startSpan("proceso");
    expect(created.spanContext().traceId).not.toBe(INVALID_TRACE_ID);
    created.end();
  });

  it("ignora un segundo start", async () => {
    const exporter = new InMemorySpanExporter();

    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    startTracing();

    const span = trace.getTracer("sports-api-test").startSpan("manual-span");
    span.end();
    await exporter.forceFlush();

    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it("permite apagar el SDK más de una vez", async () => {
    await shutdownTracing();
    await shutdownTracing();
  });
});
