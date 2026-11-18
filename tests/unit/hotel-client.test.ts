import { describe, expect, it, vi } from "vitest";

import {
  HotelConfigError,
  HotelRequestError,
  obtenerHabitacion,
} from "../../src/clients/hotel.client";

describe("hotel.client", () => {
  it("falla si falta HOTEL_API_URL", async () => {
    await expect(
      obtenerHabitacion(1, "t1", { env: {}, fetch: vi.fn() }),
    ).rejects.toBeInstanceOf(HotelConfigError);
  });

  it("propaga x-trace-id y parsea la habitación", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 7,
        numeroHabitacion: "202",
        precioHabitacion: 50,
        estadoHabitacion: "libre",
        tipoHabitacion: "suite",
      }),
    });

    const habitacion = await obtenerHabitacion(7, "biz-trace", {
      env: { HOTEL_API_URL: "http://hotel.test" },
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(habitacion.id).toBe(7);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hotel.test/api/v2/habitacion/7",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-trace-id": "biz-trace" }),
      }),
    );
  });

  it("normaliza precioHabitacion string de Hotel OCI", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 1,
        numeroHabitacion: "101",
        precioHabitacion: "150000.00",
        estadoHabitacion: "Disponible",
        tipoHabitacion: "Doble",
      }),
    });

    const habitacion = await obtenerHabitacion(1, "oci-trace", {
      env: { HOTEL_API_URL: "http://149.130.165.30" },
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(habitacion.precioHabitacion).toBe(150000);
    expect(habitacion.numeroHabitacion).toBe("101");
  });

  it("lanza HotelRequestError en 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Unavailable",
    });

    await expect(
      obtenerHabitacion(1, "t", {
        env: { HOTEL_API_URL: "http://hotel.test" },
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HotelRequestError);
  });
});
