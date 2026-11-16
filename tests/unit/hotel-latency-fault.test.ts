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
