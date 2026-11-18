import { describe, expect, it } from "vitest";

import { HotelRequestError } from "../../src/clients/hotel.client";
import { CircuitOpenError } from "../../src/resilience/circuit-breaker";
import {
  buildHotelFallback,
  isHotelRecoverableError,
} from "../../src/resilience/hotel-fallback";
import { HotelTimeoutError } from "../../src/resilience/timeout";

describe("hotel fallback business payload", () => {
  it("entrega habitación con campos de contrato válidos y marca degradada", () => {
    const h = buildHotelFallback(7);
    expect(h.id).toBe(7);
    expect(typeof h.numeroHabitacion).toBe("string");
    expect(h.numeroHabitacion.length).toBeGreaterThan(0);
    expect(typeof h.precioHabitacion).toBe("number");
    expect(typeof h.estadoHabitacion).toBe("string");
    expect(typeof h.tipoHabitacion).toBe("string");
    expect(h.origenResiliencia).toBe("fallback");
    expect(h.estadoHabitacion).toContain("degradado");
  });

  it("marca timeout, circuit open y HotelRequestError 5xx como recuperables", () => {
    expect(isHotelRecoverableError(new HotelTimeoutError(40))).toBe(true);
    expect(isHotelRecoverableError(new CircuitOpenError())).toBe(true);
    expect(
      isHotelRecoverableError(new HotelRequestError(503, "Unavailable")),
    ).toBe(true);
    expect(
      isHotelRecoverableError(new HotelRequestError(500, "err")),
    ).toBe(true);
  });

  it("no marca 4xx ni errores genéricos como recuperables", () => {
    expect(
      isHotelRecoverableError(new HotelRequestError(404, "Not Found")),
    ).toBe(false);
    expect(isHotelRecoverableError(new Error("boom"))).toBe(false);
  });
});
