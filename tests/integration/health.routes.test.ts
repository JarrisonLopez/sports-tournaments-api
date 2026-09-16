import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/config/database", () => ({
  AppDataSource: {
    isInitialized: false,
    query: vi.fn(),
  },
}));

import { AppDataSource } from "../../src/config/database";
import { healthRoutes } from "../../src/routes/health.routes";

describe("Pruebas de health checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AppDataSource.isInitialized = false;
  });

  it("debe responder 200 en liveness", async () => {
    const app = Fastify();

    await app.register(healthRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      status: "ok",
    });

    await app.close();
  });

  it("debe responder 200 cuando la base de datos está disponible", async () => {
    const app = Fastify();

    AppDataSource.isInitialized = true;
    vi.mocked(AppDataSource.query).mockResolvedValue([{ 1: 1 }]);

    await app.register(healthRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      status: "ready",
    });

    await app.close();
  });

  it("debe responder 503 cuando la base de datos no está disponible", async () => {
    const app = Fastify();

    AppDataSource.isInitialized = true;
    vi.mocked(AppDataSource.query).mockRejectedValue(new Error("db down"));

    await app.register(healthRoutes);

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json()).toEqual({
      status: "not_ready",
    });
    expect(respuesta.json()).not.toHaveProperty("message");
    expect(respuesta.body).not.toContain("db down");

    await app.close();
  });
});
