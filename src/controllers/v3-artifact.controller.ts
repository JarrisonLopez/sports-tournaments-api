import { FastifyReply, FastifyRequest } from "fastify";

import {
  ObjectStorageConfigError,
  ObjectStorageRequestError,
} from "../clients/object-storage.client";
import * as v3ArtifactService from "../services/v3-artifact.service";

const TRACE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export async function crearArtifactTorneo(
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

  const traceId = request.headers["x-trace-id"];

  if (typeof traceId !== "string" || traceId.trim() === "") {
    return reply.code(400).send({
      message: "El header x-trace-id es obligatorio",
    });
  }

  if (!TRACE_ID_PATTERN.test(traceId)) {
    return reply.code(400).send({
      message: "El trace id no es válido",
    });
  }

  reply.header("x-trace-id", traceId);

  try {
    const resultado = await v3ArtifactService.publicar({
      torneoId,
      traceId,
    });

    if (!resultado) {
      return reply.code(404).send({
        message: "Torneo no encontrado",
      });
    }

    return reply.code(201).send(resultado);
  } catch (error) {
    if (error instanceof ObjectStorageConfigError) {
      return reply.code(503).send({
        message: "Error de almacenamiento",
      });
    }

    if (error instanceof ObjectStorageRequestError) {
      const statusCode = error.status === 503 ? 503 : 502;

      return reply.code(statusCode).send({
        message: "Error de almacenamiento",
      });
    }

    throw error;
  }
}
