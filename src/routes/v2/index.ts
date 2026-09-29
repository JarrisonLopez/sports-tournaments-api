import { trace } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { torneoRoutes } from "../torneo.routes";
import { canchaRoutes } from "../cancha.routes";
import { jugadorRoutes } from "../jugador.routes";
import { flujoRoutes } from "./flujo.routes";

export async function v2Routes(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    const receivedTraceId = request.headers["x-trace-id"];

    const traceId =
      typeof receivedTraceId === "string" && receivedTraceId.trim()
        ? receivedTraceId
        : randomUUID();

    request.headers["x-trace-id"] = traceId;
    reply.header("x-trace-id", traceId);
    bindTraceLog(request, reply, traceId);

    request.log.info(
      {
        method: request.method,
        url: request.url,
      },
      "Petición API V2",
    );
  });

  app.register(torneoRoutes);
  app.register(canchaRoutes);
  app.register(jugadorRoutes);
  app.register(flujoRoutes);
}

function bindTraceLog(
  request: FastifyRequest,
  reply: FastifyReply,
  traceId: string,
): void {
  const bindings: Record<string, string> = { traceId };
  const span = trace.getActiveSpan();

  if (span) {
    const spanContext = span.spanContext();

    if (trace.isSpanContextValid(spanContext)) {
      bindings.otelTraceId = spanContext.traceId;
      bindings.otelSpanId = spanContext.spanId;
    }
  }

  const tracedLog = request.log.child(bindings);
  request.log = tracedLog;
  reply.log = tracedLog;
}
