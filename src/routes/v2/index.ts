import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";

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

    request.log.info(
      {
        traceId,
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
