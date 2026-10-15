import { GoogleAuth, IdTokenClient } from "google-auth-library";

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

export class ObjectStorageAuthError extends Error {
  constructor(cause?: unknown) {
    super("No se pudo obtener el token de identidad para Object Storage", {
      cause,
    });
    this.name = "ObjectStorageAuthError";
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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-trace-id": traceId,
  };
  const audience = cloudRunServiceAudience(baseUrl);

  if (audience) {
    headers.authorization = await cloudRunAuthorization(audience);
  }

  const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
    method: "POST",
    headers,
    body: JSON.stringify(artifact),
  });

  if (!response.ok) {
    throw new ObjectStorageRequestError(response.status, response.statusText);
  }

  return (await response.json()) as ArtifactReference;
}

const CLOUD_RUN_HOST = "run.app";

let googleAuth: GoogleAuth | undefined;
const idTokenClients = new Map<string, IdTokenClient>();

function cloudRunServiceAudience(baseUrl: string): string | undefined {
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname !== CLOUD_RUN_HOST && !hostname.endsWith(`.${CLOUD_RUN_HOST}`)) {
    return undefined;
  }

  return url.origin;
}

async function cloudRunAuthorization(audience: string): Promise<string> {
  try {
    let client = idTokenClients.get(audience);

    if (!client) {
      googleAuth ??= new GoogleAuth();
      client = await googleAuth.getIdTokenClient(audience);
      idTokenClients.set(audience, client);
    }

    const headers = await client.getRequestHeaders(audience);
    const authorization = headers.Authorization ?? headers.authorization;

    if (!authorization) {
      throw new ObjectStorageAuthError();
    }

    return authorization;
  } catch (error) {
    if (error instanceof ObjectStorageAuthError) {
      throw error;
    }

    throw new ObjectStorageAuthError(error);
  }
}
