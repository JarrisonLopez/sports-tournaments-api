import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
}));

import { buildApp } from "../../src/app";
import {
  API_TRACK_HEADER,
  API_VERSION_HEADER,
} from "../../src/config/runtime-identity";
import { buscarPorId } from "../../src/services/torneo.service";

const torneo = {
  id: 1,
  nombre: "Torneo Universitario",
  deporte: "Futbol",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-09-15",
  estado: "PROGRAMADO",
};

const canaryIdentity = {
  version: "4.0.0",
  track: "canary",
} as const;

describe("GET /api/v4/torneos/:id/resumen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responde 200 con el resumen y duración inclusiva", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      estado: "PROGRAMADO",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      duracionDias: 15,
    });
    expect(Object.keys(respuesta.json()).sort()).toEqual(
      [
        "deporte",
        "duracionDias",
        "estado",
        "fechaFin",
        "fechaInicio",
        "id",
        "nombre",
      ].sort(),
    );
    expect(buscarPorId).toHaveBeenCalledWith(1);

    await app.close();
  });

  it("expone cabeceras de identidad canary sin hardcodearlas en el controlador", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");

    await app.close();
  });

  it("responde 400 si el identificador no es un entero positivo", async () => {
    const app = buildApp({ logger: false, identity: canaryIdentity });

    const casos = ["abc", "0", "-1", "1.5"];

    for (const id of casos) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/api/v4/torneos/${id}/resumen`,
      });

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.json()).toEqual({
        message: "El identificador debe ser un número entero positivo",
      });
    }

    expect(buscarPorId).not.toHaveBeenCalled();

    await app.close();
  });

  it("responde 404 si el torneo no existe", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(null);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/999/resumen",
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json()).toEqual({
      message: "Torneo no encontrado",
    });

    await app.close();
  });

  it("responde 500 controlado ante fechas invertidas persistidas", async () => {
    vi.mocked(buscarPorId).mockResolvedValue({
      ...torneo,
      fechaInicio: "2026-09-15",
      fechaFin: "2026-09-01",
    } as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({
      message: "Error interno al calcular el resumen",
    });
    expect(respuesta.body).not.toContain("fechaFin es anterior");

    await app.close();
  });

  it("responde 500 controlado ante fechas inválidas persistidas", async () => {
    vi.mocked(buscarPorId).mockResolvedValue({
      ...torneo,
      fechaInicio: "2026-02-30",
      fechaFin: "2026-03-01",
    } as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({
      message: "Error interno al calcular el resumen",
    });

    await app.close();
  });

  it("no altera el contrato de GET /torneos/:id", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/torneos/1",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual(torneo);
    expect(respuesta.json()).not.toHaveProperty("duracionDias");

    await app.close();
  });
});
