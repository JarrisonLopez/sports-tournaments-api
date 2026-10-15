import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
}));

vi.mock("../../src/clients/object-storage.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/clients/object-storage.client")>();

  return {
    ...actual,
    saveArtifact: vi.fn(),
  };
});

import { buildApp } from "../../src/app";
import {
  ObjectStorageConfigError,
  ObjectStorageRequestError,
  saveArtifact,
} from "../../src/clients/object-storage.client";
import { buscarPorId } from "../../src/services/torneo.service";

const torneo = {
  id: 1,
  nombre: "Torneo Universitario",
  deporte: "futbol",
  fechaInicio: "2026-01-01",
  fechaFin: "2026-01-02",
  estado: "PROGRAMADO",
};

describe("POST /api/v3/torneos/:id/artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responde 201 con el torneo real y la referencia del artifact", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);
    vi.mocked(saveArtifact).mockResolvedValue({
      bucket: "sports-tournaments-artifacts",
      object: "flujos/trace-1.json",
    });

    const app = buildApp({ logger: false });
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/1/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.headers["x-trace-id"]).toBe("trace-1");
    expect(respuesta.json()).toEqual({
      traceId: "trace-1",
      torneo,
      artifact: {
        bucket: "sports-tournaments-artifacts",
        object: "flujos/trace-1.json",
      },
    });
    expect(respuesta.json()).not.toHaveProperty("habitacion");
    expect(respuesta.json()).not.toHaveProperty("pelicula");
    expect(buscarPorId).toHaveBeenCalledWith(1);
    expect(saveArtifact).toHaveBeenCalledWith(
      {
        traceId: "trace-1",
        torneo,
      },
      "trace-1",
    );
    const payload = vi.mocked(saveArtifact).mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("habitacion");
    expect(payload).not.toHaveProperty("pelicula");

    await app.close();
  });

  it("responde 400 si el identificador no es un entero positivo", async () => {
    const app = buildApp({ logger: false });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/abc/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toEqual({
      message: "El identificador debe ser un número entero positivo",
    });
    expect(saveArtifact).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 400 si el identificador es cero o negativo", async () => {
    const app = buildApp({ logger: false });

    const cero = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/0/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });
    const negativo = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/-1/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(cero.statusCode).toBe(400);
    expect(negativo.statusCode).toBe(400);
    expect(saveArtifact).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 400 si falta x-trace-id", async () => {
    const app = buildApp({ logger: false });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/1/artifact",
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toEqual({
      message: "El header x-trace-id es obligatorio",
    });
    expect(buscarPorId).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 400 si x-trace-id no es válido", async () => {
    const app = buildApp({ logger: false });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/1/artifact",
      headers: {
        "x-trace-id": "../trace",
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toEqual({
      message: "El trace id no es válido",
    });
    expect(buscarPorId).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 404 si el torneo no existe", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(null);

    const app = buildApp({ logger: false });
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/999/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json()).toEqual({
      message: "Torneo no encontrado",
    });
    expect(saveArtifact).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 502 si Object Storage rechaza el artifact", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);
    vi.mocked(saveArtifact).mockRejectedValue(
      new ObjectStorageRequestError(502, "Bad Gateway"),
    );

    const app = buildApp({ logger: false });
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/1/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });
    expect(respuesta.body).not.toContain("Bad Gateway");

    await app.close();
  });

  it("responde 503 si Object Storage no está configurado", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);
    vi.mocked(saveArtifact).mockRejectedValue(new ObjectStorageConfigError());

    const app = buildApp({ logger: false });
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v3/torneos/1/artifact",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });
    expect(respuesta.body).not.toContain("OBJECT_STORAGE_API_URL");

    await app.close();
  });
});
