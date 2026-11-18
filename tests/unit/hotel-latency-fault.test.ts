import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateHotelLatencyFault,
  applyHotelLatencyIfActive,
  ChaosFaultForbiddenError,
  ChaosFaultValidationError,
  deactivateHotelLatencyFault,
  getHotelLatencyFaultState,
  resetHotelLatencyFaultForTests,
} from "../../src/chaos/hotel-latency-fault";

const TOKEN = "chaos-lab-token-minimo-32-chars!!";

describe("hotel-latency-fault", () => {
  beforeEach(() => {
    resetHotelLatencyFaultForTests();
  });

  afterEach(() => {
    resetHotelLatencyFaultForTests();
    delete process.env.HOTEL_API_URL;
  });

  it("rechaza activación si el laboratorio no está armado", () => {
    expect(() =>
      activateHotelLatencyFault({
        token: TOKEN,
        latencyMs: 100,
        ttlMs: 1000,
        config: {
          labEnabled: false,
          token: TOKEN,
          maxLatencyMs: 5000,
          maxTtlMs: 60_000,
        },
      }),
    ).toThrow(ChaosFaultForbiddenError);
  });

  it("rechaza token inválido", () => {
    expect(() =>
      activateHotelLatencyFault({
        token: "wrong",
        latencyMs: 100,
        ttlMs: 1000,
        config: {
          labEnabled: true,
          token: TOKEN,
          maxLatencyMs: 5000,
          maxTtlMs: 60_000,
        },
      }),
    ).toThrow(ChaosFaultForbiddenError);
  });

  it("valida rangos de latencia y TTL", () => {
    expect(() =>
      activateHotelLatencyFault({
        token: TOKEN,
        latencyMs: 99_999,
        ttlMs: 1000,
        config: {
          labEnabled: true,
          token: TOKEN,
          maxLatencyMs: 5000,
          maxTtlMs: 60_000,
        },
      }),
    ).toThrow(ChaosFaultValidationError);
  });

  it("marca destino real OCI vs mock de laboratorio", () => {
    const config = {
      labEnabled: true,
      token: TOKEN,
      maxLatencyMs: 5000,
      maxTtlMs: 60_000,
    };

    process.env.HOTEL_API_URL = "http://149.130.165.30";
    const oci = activateHotelLatencyFault({
      token: TOKEN,
      latencyMs: 50,
      ttlMs: 1000,
      config,
    });
    expect(oci.injectionPoint).toBe("sports-outbound-hotel-client");
    expect(oci.targetBaseUrl).toBe("http://149.130.165.30");
    expect(oci.targetsRealHotel).toBe(true);
    deactivateHotelLatencyFault("end");

    process.env.HOTEL_API_URL = "http://hotel-mock:8081";
    const mock = activateHotelLatencyFault({
      token: TOKEN,
      latencyMs: 50,
      ttlMs: 1000,
      config,
    });
    expect(mock.targetsRealHotel).toBe(false);
    deactivateHotelLatencyFault("end");
    delete process.env.HOTEL_API_URL;
  });

  it("activa, aplica delay real y revierte de forma idempotente", async () => {
    const config = {
      labEnabled: true,
      token: TOKEN,
      maxLatencyMs: 5000,
      maxTtlMs: 60_000,
    };

    const activated = activateHotelLatencyFault({
      token: TOKEN,
      latencyMs: 80,
      ttlMs: 5000,
      config,
      now: 1_000,
    });
    expect(activated.enabled).toBe(true);
    expect(activated.injectionPoint).toBe("sports-outbound-hotel-client");

    const started = Date.now();
    const delayed = await applyHotelLatencyIfActive(1_100);
    expect(delayed).toBe(80);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);

    deactivateHotelLatencyFault("end");
    deactivateHotelLatencyFault("end");
    expect(getHotelLatencyFaultState().enabled).toBe(false);
    expect(await applyHotelLatencyIfActive()).toBe(0);
  });

  it("expira automáticamente tras TTL", async () => {
    activateHotelLatencyFault({
      token: TOKEN,
      latencyMs: 50,
      ttlMs: 100,
      config: {
        labEnabled: true,
        token: TOKEN,
        maxLatencyMs: 5000,
        maxTtlMs: 60_000,
      },
      now: 0,
    });

    expect(getHotelLatencyFaultState(50).enabled).toBe(true);
    expect(getHotelLatencyFaultState(150).enabled).toBe(false);
  });
});
