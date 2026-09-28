import { afterEach, describe, expect, it, vi } from "vitest";

import { saveArtifact } from "../../src/clients/object-storage.client";

const artifact = {
  traceId: "trace-1",
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

describe("saveArtifact", () => {
  const originalUrl = process.env.OBJECT_STORAGE_API_URL;

  afterEach(() => {
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
});
