import { describe, expect, it } from "vitest";

import { buildHotelFallback } from "../../src/resilience/hotel-fallback";

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
});
