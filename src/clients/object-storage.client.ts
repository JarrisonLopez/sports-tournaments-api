export interface FlowArtifact {
  traceId: string;
  torneo: unknown;
  habitacion: unknown;
  pelicula: unknown;
}

export interface TournamentArtifact {
  traceId: string;
  torneo: unknown;
}

export class ObjectStorageConfigError extends Error {
  constructor() {
    super("OBJECT_STORAGE_API_URL no está configurada");
    this.name = "ObjectStorageConfigError";
  }
}

export class ObjectStorageRequestError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Error guardando artifact: ${status} ${statusText}`);
    this.name = "ObjectStorageRequestError";
    this.status = status;
  }
}

export interface ArtifactReference {
  bucket: string;
  object: string;
}

export async function saveArtifact(
  artifact: FlowArtifact | TournamentArtifact,
  traceId: string,
): Promise<ArtifactReference> {
  const objectStorageApiUrl = process.env.OBJECT_STORAGE_API_URL;

  if (!objectStorageApiUrl || objectStorageApiUrl.trim() === "") {
    throw new ObjectStorageConfigError();
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
    throw new ObjectStorageRequestError(response.status, response.statusText);
  }

  return (await response.json()) as ArtifactReference;
}
