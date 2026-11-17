import { afterEach, describe, expect, it, vi } from "vitest";

import {
  obtenerHabitacion,
  resetHotelCircuitBreakerForTests,
} from "../../src/clients/hotel.client";
import { CircuitOpenError } from "../../src/resilience/circuit-breaker";
import { HotelTimeoutError } from "../../src/resilience/timeout";

describe("hotel client resilience", () => {
  afterEach(() => {
    resetHotelCircuitBreakerForTests();
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
});
