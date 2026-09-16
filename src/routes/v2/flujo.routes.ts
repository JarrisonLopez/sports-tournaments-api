import { FastifyInstance } from "fastify";

import { obtenerHabitacion } from "../../clients/hotel.client";
import { obtenerPelicula } from "../../clients/cine.client";
import { saveFlowArtifact } from "../../services/artifact-storage.service";
import { buscarPorId as buscarTorneoPorId } from "../../services/torneo.service";

interface FlujoParams {
  torneoId: string;
  habitacionId: string;
  peliculaId: string;
}

export async function flujoRoutes(app: FastifyInstance) {
  app.get<{
    Params: FlujoParams;
  }>("/flujo/:torneoId/:habitacionId/:peliculaId", async (request, reply) => {
    const torneoId = Number(request.params.torneoId);
    const habitacionId = Number(request.params.habitacionId);
    const peliculaId = Number(request.params.peliculaId);

    if (
      !Number.isInteger(torneoId) ||
      !Number.isInteger(habitacionId) ||
      !Number.isInteger(peliculaId)
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

    const torneo = await buscarTorneoPorId(torneoId);

    if (!torneo) {
      return reply.status(404).send({
        message: "Torneo no encontrado",
      });
    }

    const [habitacion, pelicula] = await Promise.all([
      obtenerHabitacion(habitacionId, traceId),
      obtenerPelicula(peliculaId, traceId),
    ]);

    const artifact = {
      traceId,
      torneo,
      habitacion,
      pelicula,
    };

    const artifactObject = await saveFlowArtifact(artifact);

    return {
      ...artifact,
      artifact: {
        bucket: process.env.GCS_BUCKET_NAME || "sports-tournaments-artifacts",
        object: artifactObject,
      },
    };
  });
}
