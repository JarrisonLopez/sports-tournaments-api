import { FastifyReply, FastifyRequest } from "fastify";

import { obtenerEstadisticas } from "../services/v4-torneo-estadisticas.service";

export async function obtenerEstadisticasTorneos(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const estadisticas = await obtenerEstadisticas();

    return reply.code(200).send(estadisticas);
  } catch (error) {
    request.log.error(
      { err: error },
      "Error al consultar estadísticas de torneos",
    );

    return reply.code(500).send({
      message: "Error interno al consultar estadísticas",
    });
  }
}
