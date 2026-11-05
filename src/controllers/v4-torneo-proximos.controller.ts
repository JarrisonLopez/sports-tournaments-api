import { FastifyReply, FastifyRequest } from "fastify";

import {
  listarProximos,
  parseLimite,
  PROXIMOS_LIMITE_MAXIMO,
  PROXIMOS_LIMITE_PREDETERMINADO,
  TorneoProximosError,
} from "../services/v4-torneo-proximos.service";

export async function obtenerTorneosProximos(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { limite: limiteQuery } = request.query as { limite?: unknown };
  const limite = parseLimite(limiteQuery);

  if (limite === null) {
    return reply.code(400).send({
      message: `El límite debe ser un entero entre 1 y ${PROXIMOS_LIMITE_MAXIMO}`,
    });
  }

  try {
    const torneos = await listarProximos({
      limite: limite ?? PROXIMOS_LIMITE_PREDETERMINADO,
    });

    return reply.code(200).send(torneos);
  } catch (error) {
    if (error instanceof TorneoProximosError || error instanceof Error) {
      request.log.error({ err: error }, "Error al consultar torneos próximos");
    }

    return reply.code(500).send({
      message: "Error interno al consultar torneos próximos",
    });
  }
}
