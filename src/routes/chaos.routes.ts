import { FastifyInstance } from "fastify";

import {
  activateHotelLatencyFault,
  ChaosFaultForbiddenError,
  ChaosFaultValidationError,
  deactivateHotelLatencyFault,
  getHotelLatencyFaultState,
  resolveHotelLatencyFaultConfig,
} from "../chaos/hotel-latency-fault";

/**
 * Endpoints de laboratorio para armar/desarmar latencia Hotel.
 * No son API pública de producto: exigen CHAOS_LAB_ENABLED + token.
 */
export async function chaosRoutes(app: FastifyInstance) {
  app.get("/chaos/hotel-latency", async () => {
    return getHotelLatencyFaultState();
  });

  app.post("/chaos/hotel-latency", async (request, reply) => {
    const body = (request.body ?? {}) as {
      token?: string;
      latencyMs?: number;
      ttlMs?: number;
    };

    try {
      const state = activateHotelLatencyFault({
        token: typeof body.token === "string" ? body.token : "",
        latencyMs: Number(body.latencyMs),
        ttlMs: Number(body.ttlMs),
        config: resolveHotelLatencyFaultConfig(),
      });
      return reply.code(200).send(state);
    } catch (error) {
      return mapChaosError(reply, error);
    }
  });

  app.delete("/chaos/hotel-latency", async (request, reply) => {
    const tokenHeader = request.headers["x-chaos-token"];
    const config = resolveHotelLatencyFaultConfig();

    if (!config.labEnabled || config.token === null) {
      return reply.code(403).send({ message: "laboratorio de caos no armado" });
    }

    if (tokenHeader !== config.token) {
      return reply.code(403).send({ message: "token de caos inválido" });
    }

    return deactivateHotelLatencyFault("end");
  });
}

function mapChaosError(reply: import("fastify").FastifyReply, error: unknown) {
  if (error instanceof ChaosFaultForbiddenError) {
    return reply.code(403).send({ message: error.message });
  }
  if (error instanceof ChaosFaultValidationError) {
    return reply.code(400).send({ message: error.message });
  }
  throw error;
}
