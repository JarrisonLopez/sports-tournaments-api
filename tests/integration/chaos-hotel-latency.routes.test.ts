import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { resetHotelLatencyFaultForTests } from "../../src/chaos/hotel-latency-fault";

const TOKEN = "chaos-lab-token-minimo-32-chars!!";

describe("chaos hotel latency routes", () => {
  beforeEach(() => {
    resetHotelLatencyFaultForTests();
  });

  afterEach(() => {
    resetHotelLatencyFaultForTests();
    delete process.env.CHAOS_LAB_ENABLED;
    delete process.env.CHAOS_FAULT_TOKEN;
  });

  it(
    "arma, consulta y desarma el interruptor con token de laboratorio",
    async () => {
    process.env.CHAOS_LAB_ENABLED = "true";
    process.env.CHAOS_FAULT_TOKEN = TOKEN;

    const app = buildApp({
      logger: false,
      env: {
        CHAOS_LAB_ENABLED: "true",
        CHAOS_FAULT_TOKEN: TOKEN,
        API_VERSION: "4.1.0",
        API_TRACK: "lab",
      },
    });

    const denied = await app.inject({
      method: "POST",
      url: "/chaos/hotel-latency",
      payload: { token: "nope", latencyMs: 100, ttlMs: 1000 },
    });
    expect(denied.statusCode).toBe(403);

    const on = await app.inject({
      method: "POST",
      url: "/chaos/hotel-latency",
      payload: { token: TOKEN, latencyMs: 100, ttlMs: 5000 },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().enabled).toBe(true);
    expect(on.json().injectionPoint).toBe("sports-outbound-hotel-client");

    const status = await app.inject({ method: "GET", url: "/chaos/hotel-latency" });
    expect(status.json().enabled).toBe(true);

    const off = await app.inject({
      method: "DELETE",
      url: "/chaos/hotel-latency",
      headers: { "x-chaos-token": TOKEN },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);

    await app.close();
  },
  30_000,
  );

  it("rechaza DELETE si el laboratorio no está armado", async () => {
    const app = buildApp({
      logger: false,
      env: {
        API_VERSION: "4.1.0",
        API_TRACK: "lab",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/chaos/hotel-latency",
      headers: { "x-chaos-token": TOKEN },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/laboratorio de caos no armado/i);

    await app.close();
  });

  it("rechaza DELETE con token inválido y POST con latencia fuera de rango", async () => {
    process.env.CHAOS_LAB_ENABLED = "true";
    process.env.CHAOS_FAULT_TOKEN = TOKEN;

    const app = buildApp({
      logger: false,
      env: {
        CHAOS_LAB_ENABLED: "true",
        CHAOS_FAULT_TOKEN: TOKEN,
        API_VERSION: "4.1.0",
        API_TRACK: "lab",
      },
    });

    const badDelete = await app.inject({
      method: "DELETE",
      url: "/chaos/hotel-latency",
      headers: { "x-chaos-token": "token-incorrecto" },
    });
    expect(badDelete.statusCode).toBe(403);
    expect(badDelete.json().message).toMatch(/token de caos inválido/i);

    const badLatency = await app.inject({
      method: "POST",
      url: "/chaos/hotel-latency",
      payload: { token: TOKEN, latencyMs: -1, ttlMs: 1000 },
    });
    expect(badLatency.statusCode).toBe(400);
    expect(badLatency.json().message).toMatch(/latencyMs fuera de rango/i);

    await app.close();
  });
});
