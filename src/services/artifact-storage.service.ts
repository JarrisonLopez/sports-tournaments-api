import { Storage } from "@google-cloud/storage";

const storage = new Storage();

const bucketName =
  process.env.GCS_BUCKET_NAME || "sports-tournaments-artifacts";

export interface FlowArtifact {
  traceId: string;
  torneo: unknown;
  habitacion: unknown;
  pelicula: unknown;
}

export async function saveFlowArtifact(
  artifact: FlowArtifact,
): Promise<string> {
  const objectName = `flujos/${artifact.traceId}.json`;

  const file = storage.bucket(bucketName).file(objectName);

  await file.save(JSON.stringify(artifact, null, 2), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      metadata: {
        traceId: artifact.traceId,
      },
    },
  });

  return objectName;
}