import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { context, SpanKind, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { obtenerHabitacion } from "../../src/clients/hotel.client";
import { obtenerPelicula } from "../../src/clients/cine.client";
import { shutdownTracing, startTracing } from "../../src/instrumentation";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

type Captured = {
  rawTraceparent: string | string[] | undefined;
  traceparent: string | undefined;
  tracestate: string | undefined;
  xTraceId: string | undefined;
};

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | string[] | undefined {
  return headers[name];
}

function singleHeader(
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
    throw new Error("sin puerto");
  }
  return `http://127.0.0.1:${address.port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function flushSpans(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };
  await provider.getDelegate?.()?.forceFlush?.();
}

describe("Propagación W3C saliente (un solo traceparent)", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await shutdownTracing();
    await Promise.all(servers.splice(0).map(close));
  });

  it("Hotel y Cine reciben el mismo Trace ID con un único traceparent válido", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const hotelCap: Captured = {
      rawTraceparent: undefined,
      traceparent: undefined,
      tracestate: undefined,
      xTraceId: undefined,
    };
    const cineCap: Captured = {
      rawTraceparent: undefined,
      traceparent: undefined,
      tracestate: undefined,
      xTraceId: undefined,
    };

    const hotelServer = createServer((req, res) => {
      hotelCap.rawTraceparent = headerValue(req.headers, "traceparent");
      hotelCap.traceparent = singleHeader(req.headers, "traceparent");
      hotelCap.tracestate = singleHeader(req.headers, "tracestate");
      hotelCap.xTraceId = singleHeader(req.headers, "x-trace-id");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: 1,
          numeroHabitacion: "101",
          precioHabitacion: 10,
          estadoHabitacion: "ok",
          tipoHabitacion: "d",
        }),
      );
    });
    servers.push(hotelServer);
    const hotelUrl = await listen(hotelServer);

    const cineServer = createServer((req, res) => {
      cineCap.rawTraceparent = headerValue(req.headers, "traceparent");
      cineCap.traceparent = singleHeader(req.headers, "traceparent");
      cineCap.tracestate = singleHeader(req.headers, "tracestate");
      cineCap.xTraceId = singleHeader(req.headers, "x-trace-id");
      res.writeHead(200, {
        "content-type": "application/json",
        traceparent: singleHeader(req.headers, "traceparent") ?? "",
      });
      res.end(
        JSON.stringify({
          origen: "database",
          traceId: "biz-w3c",
          pelicula: {
            id: 1,
            nombre: "P",
            duracion: 1,
            genero: "g",
            descripcion: "d",
          },
        }),
      );
    });
    servers.push(cineServer);
    const cineUrl = await listen(cineServer);

    const parent = trace.getTracer("w3c-test").startSpan("flujo-parent");
    const inboundTracestate = "rojo=1,congo=t61";

    await context.with(
      trace.setSpan(context.active(), parent),
      async () => {
        // Simula tracestate entrante en el contexto (si el receptor lo hubiera extraído).
        const { propagation } = await import("@opentelemetry/api");
        const carrier = {
          traceparent: `00-${parent.spanContext().traceId}-${parent.spanContext().spanId}-01`,
          tracestate: inboundTracestate,
        };
        const extracted = propagation.extract(context.active(), carrier);
        await context.with(extracted, async () => {
          await obtenerHabitacion(1, "biz-w3c", {
            env: { HOTEL_API_URL: hotelUrl, RESILIENCE_ENABLED: "false" },
          });
          await obtenerPelicula(1, "biz-w3c", {
            env: { CINE_API_URL: cineUrl },
          });
        });
      },
    );

    parent.end();
    await flushSpans();
    await exporter.forceFlush();

    // Un solo valor: sin coma (síntoma de doble inyección manual+Undici).
    expect(String(hotelCap.rawTraceparent ?? "")).not.toContain(",");
    expect(String(cineCap.rawTraceparent ?? "")).not.toContain(",");
    expect(Array.isArray(hotelCap.rawTraceparent)).toBe(false);
    expect(Array.isArray(cineCap.rawTraceparent)).toBe(false);

    expect(hotelCap.traceparent).toMatch(TRACEPARENT);
    expect(cineCap.traceparent).toMatch(TRACEPARENT);

    const hotelParsed = TRACEPARENT.exec(hotelCap.traceparent ?? "");
    const cineParsed = TRACEPARENT.exec(cineCap.traceparent ?? "");
    expect(hotelParsed?.[1]).toBe(parent.spanContext().traceId);
    expect(cineParsed?.[1]).toBe(parent.spanContext().traceId);
    expect(hotelParsed?.[2]).not.toBe(cineParsed?.[2]);

    expect(hotelCap.xTraceId).toBe("biz-w3c");
    expect(cineCap.xTraceId).toBe("biz-w3c");

    const clientSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.CLIENT);
    expect(clientSpans.length).toBeGreaterThanOrEqual(2);

    const hotelClient = clientSpans.find(
      (s) => s.name === "GET /api/v2/habitacion/:id",
    );
    const cineClient = clientSpans.find(
      (s) => s.name === "GET /api/v2/peliculas/:id",
    );
    expect(hotelClient).toBeTruthy();
    expect(cineClient).toBeTruthy();
    expect(hotelParsed?.[2]).toBe(hotelClient?.spanContext().spanId);
    expect(cineParsed?.[2]).toBe(cineClient?.spanContext().spanId);

    // tracestate se conserva cuando el contexto lo trae (Undici inject).
    expect(hotelCap.tracestate).toBe(inboundTracestate);
    expect(cineCap.tracestate).toBe(inboundTracestate);
  });
});
