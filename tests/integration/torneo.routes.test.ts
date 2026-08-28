import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const torneoRepositoryMock = {
  create: vi.fn(),
  save: vi.fn(),
  find: vi.fn(),
  findOneBy: vi.fn(),
  merge: vi.fn(),
  remove: vi.fn(),
};

vi.mock("../../src/config/database", () => ({
  AppDataSource: {
    getRepository: vi.fn(() => torneoRepositoryMock),
  },
}));

import { torneoRoutes } from "../../src/routes/torneo.routes";

describe("Pruebas de integración de torneos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debe crear un torneo correctamente", async () => {
    const app = Fastify();

    const torneo = {
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      estado: "PROGRAMADO",
    };

    torneoRepositoryMock.create.mockReturnValue(torneo);
    torneoRepositoryMock.save.mockResolvedValue(torneo);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "POST",
      url: "/torneos",
      payload: {
        nombre: "Torneo Universitario",
        deporte: "Futbol",
        fechaInicio: "2026-09-01",
        fechaFin: "2026-09-15",
        estado: "PROGRAMADO",
      },
    });

    expect(respuesta.statusCode).toBe(201);

    await app.close();
  });

  it("debe consultar todos los torneos", async () => {
    const app = Fastify();

    torneoRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Torneo Universitario",
        deporte: "Futbol",
        estado: "PROGRAMADO",
      },
    ]);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/torneos",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe consultar un torneo por id", async () => {
    const app = Fastify();

    torneoRepositoryMock.findOneBy.mockResolvedValue({
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      estado: "PROGRAMADO",
    });

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/torneos/1",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe devolver 404 si el torneo no existe", async () => {
    const app = Fastify();

    torneoRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/torneos/999",
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe actualizar un torneo correctamente", async () => {
    const app = Fastify();

    const torneo = {
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      estado: "PROGRAMADO",
    };

    torneoRepositoryMock.findOneBy.mockResolvedValue(torneo);
    torneoRepositoryMock.save.mockResolvedValue({
      ...torneo,
      estado: "EN CURSO",
    });

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "PATCH",
      url: "/torneos/1",
      payload: {
        estado: "EN CURSO",
      },
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe eliminar un torneo correctamente", async () => {
    const app = Fastify();

    const torneo = {
      id: 1,
      nombre: "Torneo Universitario",
    };

    torneoRepositoryMock.findOneBy.mockResolvedValue(torneo);
    torneoRepositoryMock.remove.mockResolvedValue(torneo);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "DELETE",
      url: "/torneos/1",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe devolver 404 al actualizar un torneo que no existe", async () => {
    const app = Fastify();

    torneoRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "PATCH",
      url: "/torneos/999",
      payload: {
        estado: "EN CURSO",
      },
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe devolver 404 al eliminar un torneo que no existe", async () => {
    const app = Fastify();

    torneoRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "DELETE",
      url: "/torneos/999",
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe filtrar torneos por deporte", async () => {
    const app = Fastify();

    torneoRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Torneo de Futbol",
        deporte: "Futbol",
        estado: "PROGRAMADO",
      },
    ]);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/torneos?deporte=Futbol",
    });

    expect(respuesta.statusCode).toBe(200);

    expect(torneoRepositoryMock.find).toHaveBeenCalledWith({
      where: {
        deporte: "Futbol",
      },
    });

    await app.close();
  });

  it("debe filtrar torneos por deporte y estado", async () => {
    const app = Fastify();

    torneoRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Torneo de Futbol",
        deporte: "Futbol",
        estado: "PROGRAMADO",
      },
    ]);

    await app.register(torneoRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/torneos?deporte=Futbol&estado=PROGRAMADO",
    });

    expect(respuesta.statusCode).toBe(200);

    expect(torneoRepositoryMock.find).toHaveBeenCalledWith({
      where: {
        deporte: "Futbol",
        estado: "PROGRAMADO",
      },
    });

    await app.close();
  });

});