import { FastifyReply, FastifyRequest } from "fastify";

import * as v4TorneoResumenService from "../services/v4-torneo-resumen.service";
import { TorneoResumenError } from "../services/v4-torneo-resumen.service";

export async function obtenerResumenTorneo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };
  const torneoId = Number(id);

  if (!Number.isInteger(torneoId) || torneoId <= 0) {
    return reply.code(400).send({
      message: "El identificador debe ser un número entero positivo",
    });
  }

  try {
    const resumen = await v4TorneoResumenService.obtenerResumen(torneoId);

    if (!resumen) {
      return reply.code(404).send({
        message: "Torneo no encontrado",
      });
    }

    return reply.code(200).send(resumen);
  } catch (error) {
    if (error instanceof TorneoResumenError) {
      return reply.code(500).send({
        message: "Error interno al calcular el resumen",
      });
    }

    throw error;
  }
}
