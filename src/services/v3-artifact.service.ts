import { saveArtifact } from "../clients/object-storage.client";
import { buscarPorId as buscarTorneoPorId } from "./torneo.service";

export async function publicar(datos: {
  torneoId: number;
  traceId: string;
}) {
  const torneo = await buscarTorneoPorId(datos.torneoId);

  if (!torneo) {
    return null;
  }

  const artifact = {
    traceId: datos.traceId,
    torneo,
  };

  const referencia = await saveArtifact(artifact, datos.traceId);

  return {
    traceId: datos.traceId,
    torneo,
    artifact: referencia,
  };
}
