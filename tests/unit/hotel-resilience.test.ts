import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateHotelLatencyFault,
  resetHotelLatencyFaultForTests,
} from "../../src/chaos/hotel-latency-fault";
import {
  obtenerHabitacion,
  resetHotelCircuitBreakerForTests,
} from "../../src/clients/hotel.client";
import { CircuitOpenError } from "../../src/resilience/circuit-breaker";
import { HotelTimeoutError } from "../../src/resilience/timeout";

const CHAOS_TOKEN = "chaos-lab-token-minimo-32-chars!!";

describe("hotel client resilience", () => {
  afterEach(() => {
    resetHotelCircuitBreakerForTests();
    resetHotelLatencyFaultForTests();
    delete process.env.CHAOS_LAB_ENABLED;
    delete process.env.CHAOS_FAULT_TOKEN;
    delete process.env.HOTEL_API_URL;
  });

  it("aplica timeout cuando RESILIENCE_ENABLED=true sin fallback", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const t = setTimeout(() => reject(new Error("should-not-finish")), 500);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    await expect(
      obtenerHabitacion(1, "t", {
        env: {
          HOTEL_API_URL: "http://hotel.test",
          RESILIENCE_ENABLED: "true",
          HOTEL_FALLBACK_ENABLED: "false",
          HOTEL_TIMEOUT_MS: "40",
          HOTEL_CB_FAILURE_THRESHOLD: "10",
        },
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HotelTimeoutError);
  });

  it("usa fallback de negocio cuando timeout y fallback están activos", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const t = setTimeout(() => reject(new Error("late")), 500);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    const habitacion = await obtenerHabitacion(9, "t", {
      env: {
        HOTEL_API_URL: "http://hotel.test",
        RESILIENCE_ENABLED: "true",
        HOTEL_FALLBACK_ENABLED: "true",
        HOTEL_TIMEOUT_MS: "40",
        HOTEL_CB_FAILURE_THRESHOLD: "10",
      },
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(habitacion.origenResiliencia).toBe("fallback");
    expect(habitacion.id).toBe(9);
  });

  it("abre el circuit breaker tras fallos repetidos", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "err",
    });

    const env = {
      HOTEL_API_URL: "http://hotel.test",
      RESILIENCE_ENABLED: "true",
      HOTEL_FALLBACK_ENABLED: "false",
      HOTEL_TIMEOUT_MS: "1000",
      HOTEL_CB_FAILURE_THRESHOLD: "2",
      HOTEL_CB_OPEN_MS: "10000",
    };

    await expect(
      obtenerHabitacion(1, "t", { env, fetch: fetchMock as never }),
    ).rejects.toThrow();
    await expect(
      obtenerHabitacion(1, "t", { env, fetch: fetchMock as never }),
    ).rejects.toThrow();
    await expect(
      obtenerHabitacion(1, "t", { env, fetch: fetchMock as never }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("no aplica circuit breaker si resiliencia está deshabilitada", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "err",
    });

    const env = {
      HOTEL_API_URL: "http://hotel.test",
      RESILIENCE_ENABLED: "false",
    };

    for (let i = 0; i < 5; i += 1) {
      await expect(
        obtenerHabitacion(1, "t", { env, fetch: fetchMock as never }),
      ).rejects.toThrow(/Error consultando Habitación/);
    }
  });

  it("R0: HTTP 503 propaga error sin timeout/CB/fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const env = {
      HOTEL_API_URL: "http://hotel.test",
      RESILIENCE_ENABLED: "false",
      HOTEL_FALLBACK_ENABLED: "false",
      HOTEL_TIMEOUT_MS: "2000",
    };

    for (let i = 0; i < 4; i += 1) {
      await expect(
        obtenerHabitacion(1, "t-r0", { env, fetch: fetchMock as never }),
      ).rejects.toMatchObject({ name: "HotelRequestError", status: 503 });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("R1: HTTP 503 activa fallback inmediato (partial)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const habitacion = await obtenerHabitacion(3, "t-r1", {
      env: {
        HOTEL_API_URL: "http://hotel.test",
        RESILIENCE_ENABLED: "true",
        HOTEL_FALLBACK_ENABLED: "true",
        HOTEL_TIMEOUT_MS: "2000",
        HOTEL_CB_FAILURE_THRESHOLD: "10",
      },
      fetch: fetchMock as never,
    });

    expect(habitacion.origenResiliencia).toBe("fallback");
    expect(habitacion.id).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("R1: HTTP 503 abre CB y luego sirve fallback por CircuitOpenError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const env = {
      HOTEL_API_URL: "http://hotel.test",
      RESILIENCE_ENABLED: "true",
      HOTEL_FALLBACK_ENABLED: "true",
      HOTEL_TIMEOUT_MS: "2000",
      HOTEL_CB_FAILURE_THRESHOLD: "2",
      HOTEL_CB_OPEN_MS: "10000",
    };

    const first = await obtenerHabitacion(1, "t-cb-1", {
      env,
      fetch: fetchMock as never,
    });
    const second = await obtenerHabitacion(1, "t-cb-2", {
      env,
      fetch: fetchMock as never,
    });
    const third = await obtenerHabitacion(1, "t-cb-3", {
      env,
      fetch: fetchMock as never,
    });

    expect(first.origenResiliencia).toBe("fallback");
    expect(second.origenResiliencia).toBe("fallback");
    expect(third.origenResiliencia).toBe("fallback");
    // Tras threshold=2 el tercero no llama a Hotel (CB open).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("R1: HTTP 404 no usa fallback (solo 5xx)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(
      obtenerHabitacion(1, "t-404", {
        env: {
          HOTEL_API_URL: "http://hotel.test",
          RESILIENCE_ENABLED: "true",
          HOTEL_FALLBACK_ENABLED: "true",
        },
        fetch: fetchMock as never,
      }),
    ).rejects.toMatchObject({ name: "HotelRequestError", status: 404 });
  });

  it("intercloud R1: latencia 800ms dentro de timeout 400ms aborta antes del fetch y usa fallback", async () => {
    process.env.CHAOS_LAB_ENABLED = "true";
    process.env.CHAOS_FAULT_TOKEN = CHAOS_TOKEN;
    process.env.HOTEL_API_URL = "http://149.130.165.30";

    activateHotelLatencyFault({
      token: CHAOS_TOKEN,
      latencyMs: 800,
      ttlMs: 30_000,
      config: {
        labEnabled: true,
        token: CHAOS_TOKEN,
        maxLatencyMs: 10_000,
        maxTtlMs: 120_000,
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 1,
        numeroHabitacion: "101",
        precioHabitacion: 1,
        estadoHabitacion: "ok",
        tipoHabitacion: "std",
      }),
    });

    const started = Date.now();
    const habitacion = await obtenerHabitacion(1, "t-lat-r1", {
      env: {
        HOTEL_API_URL: "http://149.130.165.30",
        RESILIENCE_ENABLED: "true",
        HOTEL_FALLBACK_ENABLED: "true",
        HOTEL_TIMEOUT_MS: "400",
        HOTEL_CB_FAILURE_THRESHOLD: "10",
        CHAOS_LAB_ENABLED: "true",
        CHAOS_FAULT_TOKEN: CHAOS_TOKEN,
      },
      fetch: fetchMock as never,
    });
    const elapsed = Date.now() - started;

    expect(habitacion.origenResiliencia).toBe("fallback");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(700);
  });

  it("intercloud R0: latencia 800ms sin resiliencia llega al fetch tras el delay", async () => {
    process.env.CHAOS_LAB_ENABLED = "true";
    process.env.CHAOS_FAULT_TOKEN = CHAOS_TOKEN;
    process.env.HOTEL_API_URL = "http://149.130.165.30";

    activateHotelLatencyFault({
      token: CHAOS_TOKEN,
      latencyMs: 200,
      ttlMs: 30_000,
      config: {
        labEnabled: true,
        token: CHAOS_TOKEN,
        maxLatencyMs: 10_000,
        maxTtlMs: 120_000,
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 1,
        numeroHabitacion: "101",
        precioHabitacion: 10,
        estadoHabitacion: "ok",
        tipoHabitacion: "std",
      }),
    });

    const started = Date.now();
    const habitacion = await obtenerHabitacion(1, "t-lat-r0", {
      env: {
        HOTEL_API_URL: "http://149.130.165.30",
        RESILIENCE_ENABLED: "false",
        CHAOS_LAB_ENABLED: "true",
        CHAOS_FAULT_TOKEN: CHAOS_TOKEN,
      },
      fetch: fetchMock as never,
    });
    const elapsed = Date.now() - started;

    expect(habitacion.origenResiliencia).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(180);
  });
});
