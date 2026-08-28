import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const canchaRepositoryMock = {
  create: vi.fn(),
  save: vi.fn(),
  find: vi.fn(),
  findOneBy: vi.fn(),
  merge: vi.fn(),
  remove: vi.fn(),
};

vi.mock("../../src/config/database", () => ({
  AppDataSource: {
    getRepository: vi.fn(() => canchaRepositoryMock),
  },
}));

import { canchaRoutes } from "../../src/routes/cancha.routes";

describe("Pruebas de integración de canchas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debe crear una cancha correctamente", async () => {
    const app = Fastify();

    const cancha = {
      id: 1,
      nombre: "Cancha Principal",
      ubicacion: "Unidad Deportiva",
      tipoSuperficie: "Sintetica",
      disponible: true,
    };

    canchaRepositoryMock.create.mockReturnValue(cancha);
    canchaRepositoryMock.save.mockResolvedValue(cancha);

    await app.register(canchaRoutes);

    const respuesta = await app.inject({
      method: "POST",
      url: "/canchas",
      payload: {
        nombre: "Cancha Principal",
        ubicacion: "Unidad Deportiva",
        tipoSuperficie: "Sintetica",
        disponible: true,
      },
    });

    expect(respuesta.statusCode).toBe(201);

    await app.close();
  });

  it("debe consultar todas las canchas", async () => {
    const app = Fastify();

    canchaRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Cancha Principal",
        ubicacion: "Unidad Deportiva",
        tipoSuperficie: "Sintetica",
        disponible: true,
      },
    ]);

    await app.register(canchaRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/canchas",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe consultar una cancha por id", async () => {
    const app = Fastify();

    canchaRepositoryMock.findOneBy.mockResolvedValue({
      id: 1,
      nombre: "Cancha Principal",
      ubicacion: "Unidad Deportiva",
      tipoSuperficie: "Sintetica",
      disponible: true,
    });

    await app.register(canchaRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/canchas/1",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe devolver 404 si la cancha no existe", async () => {
    const app = Fastify();

    canchaRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(canchaRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/canchas/999",
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe actualizar una cancha correctamente", async () => {
    const app = Fastify();

    const cancha = {
      id: 1,
      nombre: "Cancha Principal",
      ubicacion: "Unidad Deportiva",
      tipoSuperficie: "Sintetica",
      disponible: true,
    };

    canchaRepositoryMock.findOneBy.mockResolvedValue(cancha);
    canchaRepositoryMock.save.mockResolvedValue({
      ...cancha,
      disponible: false,
    });

    await app.register(canchaRoutes);

    const respuesta = await app.inject({
      method: "PATCH",
      url: "/canchas/1",
      payload: {
        disponible: false,
      },
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe eliminar una cancha correctamente", async () => {
    const app = Fastify();

    const cancha = {
      id: 1,
      nombre: "Cancha Principal",
    };

    canchaRepositoryMock.findOneBy.mockResolvedValue(cancha);
    canchaRepositoryMock.remove.mockResolvedValue(cancha);

    await app.register(canchaRoutes);

    const respuesta = await app.inject({
      method: "DELETE",
      url: "/canchas/1",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });
});