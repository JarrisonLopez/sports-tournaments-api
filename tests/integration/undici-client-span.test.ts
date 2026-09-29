import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { context, SpanKind, trace, type Span } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { obtenerHabitacion } from "../../src/clients/hotel.client";
import { shutdownTracing, startTracing } from "../../src/instrumentation";

const TRACEPARENT =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const HABITACION = {
  id: 7,
  numeroHabitacion: "101",
  precioHabitacion: 100,
  estadoHabitacion: "disponible",
  tipoHabitacion: "doble",
};

async function flushSpans(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };

  await provider.getDelegate?.()?.forceFlush?.();
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];

  return Array.isArray(value) ? value[0] : value;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El servidor no expuso un puerto TCP");
  }

  return `http://127.0.0.1:${address.port}`;
}

function close(server: Server): Promise<void> {
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

function clientSpans(exporter: InMemorySpanExporter): ReadableSpan[] {
  return exporter
    .getFinishedSpans()
    .filter((span) => span.kind === SpanKind.CLIENT);
}

function startParent(): Span {
  return trace.getTracer("undici-client-span-test").startSpan("operacion-padre");
}

describe("Spans CLIENT de Undici en Sports", () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  it("propaga traceparent W3C dentro de un span padre activo", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const businessTraceId = "trace-negocio-fetch";
    let received: IncomingHttpHeaders | undefined;
    const server = createServer((request, response) => {
      received = request.headers;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });

    try {
      const baseUrl = await listen(server);
      const parent = startParent();

      await context.with(trace.setSpan(context.active(), parent), async () => {
        const response = await fetch(
          `${baseUrl}/api/v2/peliculas/42?detalle=1`,
          {
            headers: {
              "x-trace-id": businessTraceId,
            },
          },
        );

        expect(response.status).toBe(200);
        await response.arrayBuffer();
      });

      const parentContext = parent.spanContext();
      parent.end();
      await flushSpans();
      await exporter.forceFlush();

      const spans = clientSpans(exporter);
      expect(spans).toHaveLength(1);

      const client = spans[0];
      expect(client?.name).toBe("GET /api/v2/peliculas/:id");
      expect(client?.attributes["url.path"]).toBe("/api/v2/peliculas/42");
      expect(client?.spanContext().traceId).toBe(parentContext.traceId);
      expect(client?.parentSpanContext?.spanId).toBe(parentContext.spanId);

      const traceparent = headerValue(received ?? {}, "traceparent");
      expect(traceparent).toMatch(TRACEPARENT);

      const parsed = TRACEPARENT.exec(traceparent ?? "");
      expect(parsed?.[1]).toBe(client?.spanContext().traceId);
      expect(parsed?.[2]).toBe(client?.spanContext().spanId);
      expect(headerValue(received ?? {}, "x-trace-id")).toBe(businessTraceId);
      expect(businessTraceId).not.toBe(client?.spanContext().traceId);
    } finally {
      await close(server);
    }
  });

  it("instrumenta obtenerHabitacion sin escribir traceparent en el cliente", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const businessTraceId = "trace-negocio-hotel";
    let received: IncomingHttpHeaders | undefined;
    const server = createServer((request, response) => {
      received = request.headers;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(HABITACION));
    });

    const previousHotelUrl = process.env.HOTEL_API_URL;

    try {
      const baseUrl = await listen(server);
      process.env.HOTEL_API_URL = baseUrl;
      const parent = startParent();

      const habitacion = await context.with(
        trace.setSpan(context.active(), parent),
        () => obtenerHabitacion(7, businessTraceId),
      );

      parent.end();
      await flushSpans();
      await exporter.forceFlush();

      expect(habitacion).toEqual(HABITACION);

      const spans = clientSpans(exporter);
      expect(spans).toHaveLength(1);
      expect(spans[0]?.name).toBe("GET /api/v2/habitacion/:id");
      expect(spans[0]?.attributes["url.path"]).toBe("/api/v2/habitacion/7");
      expect(spans[0]?.parentSpanContext?.spanId).toBe(
        parent.spanContext().spanId,
      );
      expect(spans[0]?.spanContext().traceId).toBe(parent.spanContext().traceId);

      const traceparent = headerValue(received ?? {}, "traceparent");
      expect(traceparent).toMatch(TRACEPARENT);

      const parsed = TRACEPARENT.exec(traceparent ?? "");
      expect(parsed?.[1]).toBe(spans[0]?.spanContext().traceId);
      expect(parsed?.[2]).toBe(spans[0]?.spanContext().spanId);
      expect(headerValue(received ?? {}, "x-trace-id")).toBe(businessTraceId);
      expect(businessTraceId).not.toBe(spans[0]?.spanContext().traceId);
    } finally {
      if (previousHotelUrl === undefined) {
        delete process.env.HOTEL_API_URL;
      } else {
        process.env.HOTEL_API_URL = previousHotelUrl;
      }

      await close(server);
    }
  });

  it("nombra POST /api/v2/artifacts sin identificadores y no duplica el span al reiniciar", async () => {
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      let received: IncomingHttpHeaders | undefined;
      const server = createServer((request, response) => {
        received = request.headers;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ stored: true }));
      });

      try {
        const baseUrl = await listen(server);
        const parent = startParent();

        await context.with(trace.setSpan(context.active(), parent), async () => {
          const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-trace-id": "trace-negocio-artifact",
            },
            body: JSON.stringify({ traceId: "trace-negocio-artifact" }),
          });

          expect(response.status).toBe(201);
          await response.arrayBuffer();
        });

        parent.end();
        await flushSpans();
        await exporter.forceFlush();

        const spans = clientSpans(exporter);
        expect(spans).toHaveLength(1);
        expect(spans[0]?.name).toBe("POST /api/v2/artifacts");
        expect(spans[0]?.attributes["url.path"]).toBe("/api/v2/artifacts");
        expect(headerValue(received ?? {}, "x-trace-id")).toBe(
          "trace-negocio-artifact",
        );
        expect(headerValue(received ?? {}, "content-type")).toContain(
          "application/json",
        );
        expect(headerValue(received ?? {}, "traceparent")).toMatch(TRACEPARENT);
      } finally {
        await close(server);
        await shutdownTracing();
      }
    }
  });
});
