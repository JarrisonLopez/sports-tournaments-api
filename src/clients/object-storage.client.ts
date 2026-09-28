export interface FlowArtifact {
  traceId: string;
  torneo: unknown;
  habitacion: unknown;
  pelicula: unknown;
}

export interface ArtifactReference {
  bucket: string;
  object: string;
}

export async function saveArtifact(
  artifact: FlowArtifact,
  traceId: string,
): Promise<ArtifactReference> {
  const objectStorageApiUrl = process.env.OBJECT_STORAGE_API_URL;

  if (!objectStorageApiUrl || objectStorageApiUrl.trim() === "") {
    throw new Error("OBJECT_STORAGE_API_URL no está configurada");
  }

  const baseUrl = objectStorageApiUrl.trim().replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-id": traceId,
    },
    body: JSON.stringify(artifact),
  });

  if (!response.ok) {
    throw new Error(
      `Error guardando artifact: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as ArtifactReference;
}
