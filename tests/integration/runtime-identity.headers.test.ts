import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import {
  API_TRACK_HEADER,
  API_VERSION_HEADER,
  INVALID_TRACK_VALUE,
  UNSET_IDENTITY_VALUE,
} from "../../src/config/runtime-identity";

describe("Cabeceras X-Api-Version y X-Api-Track", () => {
  it("incluye versión y track en una respuesta 200", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.1", track: "stable" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("stable");
    expect(respuesta.json()).toEqual({
      message: "API de Torneos Deportivos funcionando",
    });

    await app.close();
  });

  it("incluye las cabeceras en una respuesta 404", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.1", track: "stable" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/ruta-inexistente-canary",
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("stable");

    await app.close();
  });

  it("incluye las cabeceras en healthcheck", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.1", track: "stable" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("stable");
    expect(respuesta.json()).toEqual({
      status: "ok",
    });

    await app.close();
  });

  it("incluye las cabeceras en un error 500 controlado sin alterar el JSON", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.1", track: "stable" },
    });

    app.get("/api/v2/observability-error-identity", async (_request, reply) => {
      return reply.code(500).send({ message: "error" });
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/observability-error-identity",
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("stable");
    expect(respuesta.json()).toEqual({ message: "error" });
    expect(Object.keys(respuesta.json()).sort()).toEqual(["message"]);

    await app.close();
  });

  it("reporta track stable cuando la identidad es stable", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.1", track: "stable" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(respuesta.headers[API_TRACK_HEADER]).toBe("stable");
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");

    await app.close();
  });

  it("reporta track canary cuando la identidad es canary", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "4.0.0", track: "canary" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");

    await app.close();
  });

  it("no confunde versión con package.json 1.0.0", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "3.0.1", track: "stable" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(respuesta.headers[API_VERSION_HEADER]).not.toBe("1.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).not.toBe("1.0.0");

    await app.close();
  });

  it("usa unset o invalid según configuración ausente o inválida", async () => {
    const sinConfig = buildApp({
      logger: false,
      identity: {
        version: UNSET_IDENTITY_VALUE,
        track: UNSET_IDENTITY_VALUE,
      },
    });

    const sinConfigRespuesta = await sinConfig.inject({
      method: "GET",
      url: "/",
    });

    expect(sinConfigRespuesta.headers[API_VERSION_HEADER]).toBe(
      UNSET_IDENTITY_VALUE,
    );
    expect(sinConfigRespuesta.headers[API_TRACK_HEADER]).toBe(
      UNSET_IDENTITY_VALUE,
    );
    expect(sinConfigRespuesta.headers[API_TRACK_HEADER]).not.toBe("stable");
    expect(sinConfigRespuesta.headers[API_TRACK_HEADER]).not.toBe("canary");

    await sinConfig.close();

    const invalida = buildApp({
      logger: false,
      identity: {
        version: "3.0.1",
        track: INVALID_TRACK_VALUE,
      },
    });

    const invalidaRespuesta = await invalida.inject({
      method: "GET",
      url: "/",
    });

    expect(invalidaRespuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(invalidaRespuesta.headers[API_TRACK_HEADER]).toBe(
      INVALID_TRACK_VALUE,
    );

    await invalida.close();
  });

  it("no altera el contrato JSON de la respuesta", async () => {
    const app = buildApp({
      logger: false,
      identity: { version: "4.0.0", track: "canary" },
    });

    const root = await app.inject({ method: "GET", url: "/" });
    const live = await app.inject({ method: "GET", url: "/health/live" });

    expect(root.json()).toEqual({
      message: "API de Torneos Deportivos funcionando",
    });
    expect(Object.keys(root.json()).sort()).toEqual(["message"]);

    expect(live.json()).toEqual({
      status: "ok",
    });
    expect(Object.keys(live.json()).sort()).toEqual(["status"]);

    await app.close();
  });
});
