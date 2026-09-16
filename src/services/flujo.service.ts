import { obtenerHabitacion } from "../clients/hotel.client";
import { obtenerPelicula } from "../clients/cine.client";
import { saveFlowArtifact } from "./artifact-storage.service";
import { buscarPorId as buscarTorneoPorId } from "./torneo.service";

export async function ejecutar(datos: {
  torneoId: number;
  habitacionId: number;
  peliculaId: number;
  traceId: string;
}) {
  const torneo = await buscarTorneoPorId(datos.torneoId);

  if (!torneo) {
    return null;
  }

  const [habitacion, pelicula] = await Promise.all([
    obtenerHabitacion(datos.habitacionId, datos.traceId),
    obtenerPelicula(datos.peliculaId, datos.traceId),
  ]);

  const artifact = {
    traceId: datos.traceId,
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
}
