import { FastifyReply, FastifyRequest } from "fastify";

import * as flujoService from "../services/flujo.service";

export async function ejecutarFlujo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { torneoId, habitacionId, peliculaId } = request.params as {
    torneoId: string;
    habitacionId: string;
    peliculaId: string;
  };

  const torneoIdNumero = Number(torneoId);
  const habitacionIdNumero = Number(habitacionId);
  const peliculaIdNumero = Number(peliculaId);

  if (
    !Number.isInteger(torneoIdNumero) ||
    !Number.isInteger(habitacionIdNumero) ||
    !Number.isInteger(peliculaIdNumero)
  ) {
    return reply.status(400).send({
      message: "Los identificadores deben ser números enteros",
    });
  }

  const traceId = request.headers["x-trace-id"];

  if (typeof traceId !== "string") {
    return reply.status(500).send({
      message: "No se pudo obtener el trace id",
    });
  }

  const resultado = await flujoService.ejecutar({
    torneoId: torneoIdNumero,
    habitacionId: habitacionIdNumero,
    peliculaId: peliculaIdNumero,
    traceId,
  });

  if (!resultado) {
    return reply.status(404).send({
      message: "Torneo no encontrado",
    });
  }

  return resultado;
}
