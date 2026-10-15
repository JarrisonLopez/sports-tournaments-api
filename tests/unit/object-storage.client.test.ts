import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRequestHeaders = vi.hoisted(() => vi.fn());
const getIdTokenClient = vi.hoisted(() => vi.fn());

vi.mock("google-auth-library", () => {
  return {
    GoogleAuth: class {
      getIdTokenClient(targetAudience: string) {
        return getIdTokenClient(targetAudience);
      }
    },
  };
});

import {
  ObjectStorageAuthError,
  saveArtifact,
} from "../../src/clients/object-storage.client";

const artifact = {
  traceId: "trace-1",
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

describe("saveArtifact", () => {
  const originalUrl = process.env.OBJECT_STORAGE_API_URL;

  beforeEach(() => {
    getRequestHeaders.mockResolvedValue({
      Authorization: "Bearer test-id-token",
    });
    getIdTokenClient.mockImplementation(async () => ({
      getRequestHeaders,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    if (originalUrl === undefined) {
      delete process.env.OBJECT_STORAGE_API_URL;
    } else {
      process.env.OBJECT_STORAGE_API_URL = originalUrl;
    }
  });

  it("envía el artifact y el mismo x-trace-id", async () => {
    process.env.OBJECT_STORAGE_API_URL = "http://object-storage:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bucket: "sports-tournaments-artifacts",
        object: "flujos/trace-1.json",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const referencia = await saveArtifact(artifact, "trace-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://object-storage:3000/api/v2/artifacts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": "trace-1",
        },
        body: JSON.stringify(artifact),
      },
    );
    expect(referencia).toEqual({
      bucket: "sports-tournaments-artifacts",
      object: "flujos/trace-1.json",
    });
    expect(getIdTokenClient).not.toHaveBeenCalled();
  });

  it("quita la barra final de OBJECT_STORAGE_API_URL", async () => {
    process.env.OBJECT_STORAGE_API_URL = "http://object-storage:3000/";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bucket: "sports-tournaments-artifacts",
        object: "flujos/trace-1.json",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await saveArtifact(artifact, "trace-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://object-storage:3000/api/v2/artifacts",
      expect.any(Object),
    );
  });

  it("falla si OBJECT_STORAGE_API_URL no está configurada", async () => {
    delete process.env.OBJECT_STORAGE_API_URL;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveArtifact(artifact, "trace-1")).rejects.toThrow(
      "OBJECT_STORAGE_API_URL no está configurada",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falla si OBJECT_STORAGE_API_URL solo tiene espacios", async () => {
    process.env.OBJECT_STORAGE_API_URL = "   ";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveArtifact(artifact, "trace-1")).rejects.toThrow(
      "OBJECT_STORAGE_API_URL no está configurada",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falla si Object Storage responde con error", async () => {
    process.env.OBJECT_STORAGE_API_URL = "http://object-storage:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({
        message: "detalle-interno",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(saveArtifact(artifact, "trace-1")).rejects.toThrow(
      "Error guardando artifact: 502 Bad Gateway",
    );
  });

  it("envía un ID token cuando Object Storage está en Cloud Run", async () => {
    process.env.OBJECT_STORAGE_API_URL =
      "https://sports-demo-storage-abc-uc.a.run.app/";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bucket: "sports-tournaments-artifacts",
        object: "flujos/trace-1.json",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await saveArtifact(artifact, "trace-1");

    expect(getIdTokenClient).toHaveBeenCalledWith(
      "https://sports-demo-storage-abc-uc.a.run.app",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sports-demo-storage-abc-uc.a.run.app/api/v2/artifacts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": "trace-1",
          authorization: "Bearer test-id-token",
        },
        body: JSON.stringify(artifact),
      },
    );
  });

  it("no pide credenciales de Google para un endpoint local", async () => {
    process.env.OBJECT_STORAGE_API_URL = "http://127.0.0.1:8080";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bucket: "sports-tournaments-artifacts",
        object: "flujos/trace-1.json",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await saveArtifact(artifact, "trace-1");

    expect(getIdTokenClient).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/api/v2/artifacts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": "trace-1",
        },
        body: JSON.stringify(artifact),
      },
    );
  });

  it("no llama a Object Storage si no puede obtener el ID token", async () => {
    process.env.OBJECT_STORAGE_API_URL =
      "https://sports-demo-storage-fail-uc.a.run.app";
    getIdTokenClient.mockRejectedValue(
      new Error("Could not load the default credentials"),
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveArtifact(artifact, "trace-1")).rejects.toBeInstanceOf(
      ObjectStorageAuthError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
