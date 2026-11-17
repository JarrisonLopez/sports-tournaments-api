import { FastifyReply, FastifyRequest } from "fastify";

import * as flujoService from "../services/flujo.service";
import {
  recordFlujoResult,
  type FlujoOutcome,
} from "../observability/chaos-metrics";

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

  const started = Date.now();

  try {
    const resultado = await flujoService.ejecutar({
      torneoId: torneoIdNumero,
      habitacionId: habitacionIdNumero,
      peliculaId: peliculaIdNumero,
      traceId,
    });

    if (!resultado) {
      recordFlujoResult("error", Date.now() - started, {
        reason: "torneo_not_found",
        trace_id: traceId,
      });
      return reply.status(404).send({
        message: "Torneo no encontrado",
      });
    }

    const outcome =
      resultado.status === "partial" ? ("success" as const) : ("success" as const);
    recordFlujoResult(outcome, Date.now() - started, {
      trace_id: traceId,
      flujo_status: resultado.status,
      degraded: String(resultado.degraded),
    });
    return resultado;
  } catch (error) {
    const outcome = classifyFlujoError(error);
    recordFlujoResult(outcome, Date.now() - started, {
      trace_id: traceId,
      error_name: error instanceof Error ? error.name : "unknown",
    });

    request.log.error(
      {
        err: error,
        traceId,
        outcome,
      },
      "Flujo multicloud falló",
    );

    throw error;
  }
}

function classifyFlujoError(error: unknown): FlujoOutcome {
  if (!error || typeof error !== "object") {
    return "error";
  }

  const name = (error as { name?: string }).name;
  if (name === "HotelTimeoutError" || name === "TimeoutError") {
    return "timeout";
  }
  if (name === "CircuitOpenError") {
    return "circuit_open";
  }
  return "error";
}
