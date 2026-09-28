import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const save = vi.fn();
  const download = vi.fn();
  const file = vi.fn(() => ({ save, download }));
  const bucket = vi.fn(() => ({ file }));

  return { save, download, file, bucket };
});

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class {
      bucket(bucketName: string) {
        return mocks.bucket(bucketName);
      }
    },
  };
});

import {
  ArtifactNotFoundError,
  BucketNotConfiguredError,
  readArtifact,
  saveArtifact,
  StorageOperationError,
} from "../../src/services/artifact-storage.service";

const artifact = {
  traceId: "trace-1",
  torneo: { id: 1, nombre: "Torneo Universitario" },
  habitacion: { id: 2, numeroHabitacion: "101" },
  pelicula: { id: 3, nombre: "Pelicula" },
};

describe("artifact storage service", () => {
  const originalBucket = process.env.GCS_BUCKET_NAME;

  beforeEach(() => {
    mocks.save.mockReset();
    mocks.download.mockReset();
    mocks.file.mockReset();
    mocks.bucket.mockReset();
    mocks.file.mockImplementation(() => ({
      save: mocks.save,
      download: mocks.download,
    }));
    mocks.bucket.mockImplementation(() => ({
      file: mocks.file,
    }));
    process.env.GCS_BUCKET_NAME = "test-bucket";
  });

  afterEach(() => {
    if (originalBucket === undefined) {
      delete process.env.GCS_BUCKET_NAME;
    } else {
      process.env.GCS_BUCKET_NAME = originalBucket;
    }
  });

  it("guarda el artifact en flujos/{traceId}.json", async () => {
    mocks.save.mockResolvedValue(undefined);

    const reference = await saveArtifact(artifact);

    expect(reference).toEqual({
      bucket: "test-bucket",
      object: "flujos/trace-1.json",
    });
    expect(mocks.bucket).toHaveBeenCalledWith("test-bucket");
    expect(mocks.file).toHaveBeenCalledWith("flujos/trace-1.json");
    expect(mocks.save).toHaveBeenCalledWith(JSON.stringify(artifact, null, 2), {
      contentType: "application/json",
      resumable: false,
      metadata: {
        metadata: {
          traceId: "trace-1",
        },
      },
    });
  });

  it("lee el JSON almacenado", async () => {
    mocks.download.mockResolvedValue([
      Buffer.from(JSON.stringify(artifact, null, 2)),
    ]);

    await expect(readArtifact("trace-1")).resolves.toEqual(artifact);
    expect(mocks.bucket).toHaveBeenCalledWith("test-bucket");
    expect(mocks.file).toHaveBeenCalledWith("flujos/trace-1.json");
  });

  it("distingue un objeto inexistente de un fallo del SDK", async () => {
    const notFound = Object.assign(
      new Error("No such object: test-bucket/flujos/trace-1.json"),
      { code: 404 },
    );
    mocks.download.mockRejectedValueOnce(notFound);

    await expect(readArtifact("trace-1")).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );

    const sdkError = new Error("credential file /secret/adc.json denied");
    mocks.download.mockRejectedValueOnce(sdkError);

    await expect(readArtifact("trace-1")).rejects.toMatchObject({
      name: "StorageOperationError",
      message: "Error de almacenamiento",
      cause: sdkError,
    });
  });

  it("envuelve un fallo de escritura sin exponer el error del SDK", async () => {
    const sdkError = new Error("permission denied on secret-key");
    mocks.save.mockRejectedValue(sdkError);

    await expect(saveArtifact(artifact)).rejects.toMatchObject({
      name: "StorageOperationError",
      message: "Error de almacenamiento",
      cause: sdkError,
    });
  });

  it("no consulta GCS si el bucket no está configurado", async () => {
    delete process.env.GCS_BUCKET_NAME;

    await expect(saveArtifact(artifact)).rejects.toBeInstanceOf(
      BucketNotConfiguredError,
    );

    process.env.GCS_BUCKET_NAME = "   ";

    await expect(readArtifact("trace-1")).rejects.toBeInstanceOf(
      BucketNotConfiguredError,
    );
    expect(mocks.bucket).not.toHaveBeenCalled();
  });
});
