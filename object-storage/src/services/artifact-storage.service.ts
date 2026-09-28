import { Storage } from "@google-cloud/storage";

const storage = new Storage();

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

export class ArtifactNotFoundError extends Error {
  constructor() {
    super("Artifact no encontrado");
    this.name = "ArtifactNotFoundError";
  }
}

export class BucketNotConfiguredError extends Error {
  constructor() {
    super("GCS_BUCKET_NAME no está configurada");
    this.name = "BucketNotConfiguredError";
  }
}

export class StorageOperationError extends Error {
  constructor(cause?: unknown) {
    super("Error de almacenamiento", { cause });
    this.name = "StorageOperationError";
  }
}

export function isBucketConfigured(): boolean {
  return readBucketName() !== undefined;
}

function readBucketName(): string | undefined {
  const bucketName = process.env.GCS_BUCKET_NAME;

  if (typeof bucketName !== "string" || bucketName.trim() === "") {
    return undefined;
  }

  return bucketName;
}

function requireBucketName(): string {
  const bucketName = readBucketName();

  if (!bucketName) {
    throw new BucketNotConfiguredError();
  }

  return bucketName;
}

function objectNameFor(traceId: string): string {
  return `flujos/${traceId}.json`;
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return code === 404 || code === "404";
}

export async function saveArtifact(
  artifact: FlowArtifact,
): Promise<ArtifactReference> {
  const bucketName = requireBucketName();
  const objectName = objectNameFor(artifact.traceId);
  const file = storage.bucket(bucketName).file(objectName);

  try {
    await file.save(JSON.stringify(artifact, null, 2), {
      contentType: "application/json",
      resumable: false,
      metadata: {
        metadata: {
          traceId: artifact.traceId,
        },
      },
    });
  } catch (error) {
    throw new StorageOperationError(error);
  }

  return {
    bucket: bucketName,
    object: objectName,
  };
}

export async function readArtifact(traceId: string): Promise<unknown> {
  const bucketName = requireBucketName();
  const objectName = objectNameFor(traceId);
  const file = storage.bucket(bucketName).file(objectName);

  let contents: Buffer;

  try {
    const downloaded = await file.download();
    contents = Buffer.from(downloaded[0]);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new ArtifactNotFoundError();
    }

    throw new StorageOperationError(error);
  }

  try {
    return JSON.parse(contents.toString("utf8")) as unknown;
  } catch (error) {
    throw new StorageOperationError(error);
  }
}
