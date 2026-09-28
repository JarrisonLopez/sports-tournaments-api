import { obtenerHabitacion } from "../clients/hotel.client";
import { obtenerPelicula } from "../clients/cine.client";
import { saveArtifact } from "../clients/object-storage.client";
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

  const referencia = await saveArtifact(artifact, datos.traceId);

  return {
    ...artifact,
    artifact: referencia,
  };
}
