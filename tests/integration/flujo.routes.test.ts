import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
}));

vi.mock("../../src/clients/hotel.client", () => ({
  obtenerHabitacion: vi.fn(),
}));

vi.mock("../../src/clients/cine.client", () => ({
  obtenerPelicula: vi.fn(),
}));

vi.mock("../../src/services/artifact-storage.service", () => ({
  saveFlowArtifact: vi.fn(),
}));

import { buscarPorId } from "../../src/services/torneo.service";
import { obtenerHabitacion } from "../../src/clients/hotel.client";
import { obtenerPelicula } from "../../src/clients/cine.client";
import { saveFlowArtifact } from "../../src/services/artifact-storage.service";
import { flujoRoutes } from "../../src/routes/v2/flujo.routes";

describe("Pruebas de flujo V2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debe devolver 400 si los identificadores no son enteros", async () => {
    const app = Fastify();

    await app.register(flujoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/flujo/abc/1/2",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(400);

    await app.close();
  });

  it("debe devolver 500 si no hay trace id", async () => {
    const app = Fastify();

    await app.register(flujoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/flujo/1/2/3",
    });

    expect(respuesta.statusCode).toBe(500);

    await app.close();
  });

  it("debe devolver 404 si el torneo no existe", async () => {
    const app = Fastify();

    vi.mocked(buscarPorId).mockResolvedValue(null);

    await app.register(flujoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/flujo/999/2/3",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe construir el artifact del flujo", async () => {
    const app = Fastify();

    const torneo = { id: 1, nombre: "Torneo Universitario" };
    const habitacion = { id: 2, numeroHabitacion: "101" };
    const pelicula = { id: 3, nombre: "Pelicula" };

    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);
    vi.mocked(obtenerHabitacion).mockResolvedValue(habitacion as never);
    vi.mocked(obtenerPelicula).mockResolvedValue(pelicula as never);
    vi.mocked(saveFlowArtifact).mockResolvedValue("flujos/trace-1.json");

    await app.register(flujoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/flujo/1/2/3",
      headers: {
        "x-trace-id": "trace-1",
      },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      traceId: "trace-1",
      torneo,
      habitacion,
      pelicula,
      artifact: {
        bucket: process.env.GCS_BUCKET_NAME || "sports-tournaments-artifacts",
        object: "flujos/trace-1.json",
      },
    });

    expect(obtenerHabitacion).toHaveBeenCalledWith(2, "trace-1");
    expect(obtenerPelicula).toHaveBeenCalledWith(3, "trace-1");

    await app.close();
  });
});
