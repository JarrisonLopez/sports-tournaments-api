import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const jugadorRepositoryMock = {
  create: vi.fn(),
  save: vi.fn(),
  find: vi.fn(),
  findOneBy: vi.fn(),
  merge: vi.fn(),
  remove: vi.fn(),
};

vi.mock("../../src/config/database", () => ({
  AppDataSource: {
    getRepository: vi.fn(() => jugadorRepositoryMock),
  },
}));

import { jugadorRoutes } from "../../src/routes/jugador.routes";

describe("Pruebas de integración de jugadores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debe crear un jugador correctamente", async () => {
    const app = Fastify();

    const jugador = {
      id: 1,
      nombre: "Juan Perez",
      documento: "1000123456",
      fechaNacimiento: "2002-05-15",
      posicion: "Delantero",
    };

    jugadorRepositoryMock.create.mockReturnValue(jugador);
    jugadorRepositoryMock.save.mockResolvedValue(jugador);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "POST",
      url: "/jugadores",
      payload: {
        nombre: "Juan Perez",
        documento: "1000123456",
        fechaNacimiento: "2002-05-15",
        posicion: "Delantero",
      },
    });

    expect(respuesta.statusCode).toBe(201);

    await app.close();
  });

  it("debe consultar todos los jugadores", async () => {
    const app = Fastify();

    jugadorRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Juan Perez",
        documento: "1000123456",
        fechaNacimiento: "2002-05-15",
        posicion: "Delantero",
      },
    ]);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/jugadores",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe consultar un jugador por id", async () => {
    const app = Fastify();

    jugadorRepositoryMock.findOneBy.mockResolvedValue({
      id: 1,
      nombre: "Juan Perez",
      documento: "1000123456",
      fechaNacimiento: "2002-05-15",
      posicion: "Delantero",
    });

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/jugadores/1",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe devolver 404 si el jugador no existe", async () => {
    const app = Fastify();

    jugadorRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/jugadores/999",
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe actualizar un jugador correctamente", async () => {
    const app = Fastify();

    const jugador = {
      id: 1,
      nombre: "Juan Perez",
      documento: "1000123456",
      fechaNacimiento: "2002-05-15",
      posicion: "Delantero",
    };

    jugadorRepositoryMock.findOneBy.mockResolvedValue(jugador);
    jugadorRepositoryMock.save.mockResolvedValue({
      ...jugador,
      posicion: "Mediocampista",
    });

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "PATCH",
      url: "/jugadores/1",
      payload: {
        posicion: "Mediocampista",
      },
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe eliminar un jugador correctamente", async () => {
    const app = Fastify();

    const jugador = {
      id: 1,
      nombre: "Juan Perez",
    };

    jugadorRepositoryMock.findOneBy.mockResolvedValue(jugador);
    jugadorRepositoryMock.remove.mockResolvedValue(jugador);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "DELETE",
      url: "/jugadores/1",
    });

    expect(respuesta.statusCode).toBe(200);

    await app.close();
  });

  it("debe devolver 404 al actualizar un jugador que no existe", async () => {
    const app = Fastify();

    jugadorRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "PATCH",
      url: "/jugadores/999",
      payload: {
        posicion: "Mediocampista",
      },
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe devolver 404 al eliminar un jugador que no existe", async () => {
    const app = Fastify();

    jugadorRepositoryMock.findOneBy.mockResolvedValue(null);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "DELETE",
      url: "/jugadores/999",
    });

    expect(respuesta.statusCode).toBe(404);

    await app.close();
  });

  it("debe filtrar jugadores por nombre", async () => {
    const app = Fastify();

    jugadorRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Juan Perez",
        documento: "1000123456",
        fechaNacimiento: "2002-05-15",
        posicion: "Delantero",
      },
    ]);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/jugadores?nombre=Juan%20Perez",
    });

    expect(respuesta.statusCode).toBe(200);

    expect(jugadorRepositoryMock.find).toHaveBeenCalledWith({
      where: {
        nombre: "Juan Perez",
      },
    });

    await app.close();
  });

  it("debe filtrar jugadores por nombre y posicion", async () => {
    const app = Fastify();

    jugadorRepositoryMock.find.mockResolvedValue([
      {
        id: 1,
        nombre: "Juan Perez",
        documento: "1000123456",
        fechaNacimiento: "2002-05-15",
        posicion: "Delantero",
      },
    ]);

    await app.register(jugadorRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/jugadores?nombre=Juan%20Perez&posicion=Delantero",
    });

    expect(respuesta.statusCode).toBe(200);

    expect(jugadorRepositoryMock.find).toHaveBeenCalledWith({
      where: {
        nombre: "Juan Perez",
        posicion: "Delantero",
      },
    });

    await app.close();
  });

});