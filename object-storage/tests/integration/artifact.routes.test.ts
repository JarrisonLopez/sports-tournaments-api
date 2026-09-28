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

import { buildApp } from "../../src/app";

const artifact = {
  traceId: "trace-1",
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

describe("Rutas de artifacts", () => {
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
    mocks.save.mockResolvedValue(undefined);
    process.env.GCS_BUCKET_NAME = "test-bucket";
  });

  afterEach(() => {
    if (originalBucket === undefined) {
      delete process.env.GCS_BUCKET_NAME;
    } else {
      process.env.GCS_BUCKET_NAME = originalBucket;
    }
  });

  it("guarda un artifact válido", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.headers["x-trace-id"]).toBe("trace-1");
    expect(respuesta.json()).toEqual({
      bucket: "test-bucket",
      object: "flujos/trace-1.json",
    });
    expect(mocks.save).toHaveBeenCalledWith(JSON.stringify(artifact, null, 2), {
      contentType: "application/json",
      resumable: false,
      metadata: {
        metadata: {
          traceId: "trace-1",
        },
      },
    });

    await app.close();
  });

  it("rechaza un POST sin x-trace-id", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();

    await app.close();
  });

  it("rechaza un POST con trace vacío", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();

    await app.close();
  });

  it("rechaza un POST con trace inválido", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "../trace",
      },
      payload: {
        ...artifact,
        traceId: "../trace",
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();

    await app.close();
  });

  it("rechaza un POST si el header no coincide con el body", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: {
        ...artifact,
        traceId: "trace-2",
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();

    await app.close();
  });

  it("rechaza un POST con body incompleto", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: {
        traceId: "trace-1",
        torneo: { id: 1 },
        habitacion: { id: 2 },
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 503 en POST si el bucket no está configurado", async () => {
    delete process.env.GCS_BUCKET_NAME;
    const app = buildApp();

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });
    expect(respuesta.body).not.toContain("GCS_BUCKET_NAME");
    expect(mocks.save).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 502 si falla el almacenamiento y no filtra el error interno", async () => {
    const app = buildApp();
    mocks.save.mockRejectedValue(
      new Error("INTERNAL_SDK_SECRET permission denied"),
    );

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });
    expect(respuesta.body).not.toContain("INTERNAL_SDK_SECRET");

    await app.close();
  });

  it("recupera un artifact existente", async () => {
    const app = buildApp();
    mocks.download.mockResolvedValue([
      Buffer.from(JSON.stringify(artifact)),
    ]);

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-1",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers["x-trace-id"]).toBe("trace-1");
    expect(respuesta.json()).toEqual(artifact);
    expect(mocks.file).toHaveBeenCalledWith("flujos/trace-1.json");

    await app.close();
  });

  it("rechaza un GET sin x-trace-id", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-1",
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();

    await app.close();
  });

  it("rechaza un GET si el header no coincide con el path", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-2",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 404 si el artifact no existe", async () => {
    const app = buildApp();
    mocks.download.mockRejectedValue(
      Object.assign(new Error("No such object: test-bucket/flujos/trace-1.json"), {
        code: 404,
      }),
    );

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-1",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json()).toEqual({
      message: "Artifact no encontrado",
    });
    expect(respuesta.body).not.toContain("No such object");

    await app.close();
  });

  it("responde 503 en GET si el bucket no está configurado", async () => {
    delete process.env.GCS_BUCKET_NAME;
    const app = buildApp();

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-1",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });
    expect(respuesta.body).not.toContain("GCS_BUCKET_NAME");
    expect(mocks.download).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 502 si falla la lectura y no filtra el error interno", async () => {
    const app = buildApp();
    mocks.download.mockRejectedValue(new Error("INTERNAL_SDK_SECRET timeout"));

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-1",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });
    expect(respuesta.body).not.toContain("INTERNAL_SDK_SECRET");

    await app.close();
  });
});
