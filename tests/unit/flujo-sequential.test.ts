import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
}));

vi.mock("../../src/clients/hotel.client", () => ({
  obtenerHabitacion: vi.fn(),
}));

vi.mock("../../src/clients/cine.client", () => ({
  obtenerPelicula: vi.fn(),
}));

vi.mock("../../src/clients/object-storage.client", () => ({
  saveArtifact: vi.fn(),
}));

import { obtenerHabitacion } from "../../src/clients/hotel.client";
import { obtenerPelicula } from "../../src/clients/cine.client";
import { saveArtifact } from "../../src/clients/object-storage.client";
import { buscarPorId } from "../../src/services/torneo.service";
import { ejecutar } from "../../src/services/flujo.service";

describe("flujo secuencial Seguimiento #4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OBJECT_STORAGE_API_URL;
    process.env.FLUJO_ORCHESTRATION_MODE = "sequential";
  });

  it("consulta Hotel y luego Cine en orden, sin Object Storage si no hay URL", async () => {
    const order: string[] = [];

    vi.mocked(buscarPorId).mockResolvedValue({
      id: 1,
      nombre: "Copa",
    } as never);

    vi.mocked(obtenerHabitacion).mockImplementation(async () => {
      order.push("hotel");
      return {
        id: 2,
        numeroHabitacion: "101",
        precioHabitacion: 100,
        estadoHabitacion: "ok",
        tipoHabitacion: "std",
      };
    });

    vi.mocked(obtenerPelicula).mockImplementation(async () => {
      order.push("cine");
      return {
        id: 3,
        nombre: "Film",
        duracion: 90,
        genero: "demo",
        descripcion: "d",
      };
    });

    const result = await ejecutar({
      torneoId: 1,
      habitacionId: 2,
      peliculaId: 3,
      traceId: "trace-seq-1",
    });

    expect(order).toEqual(["hotel", "cine"]);
    expect(obtenerHabitacion).toHaveBeenCalledOnce();
    expect(obtenerPelicula).toHaveBeenCalledOnce();
    expect(saveArtifact).not.toHaveBeenCalled();
    expect(result?.habitacion.id).toBe(2);
    expect(result?.pelicula.id).toBe(3);
    expect(result?.artifact).toBeNull();
  });

  it("en modo parallel inicia ambas dependencias sin await intermedio de orden", async () => {
    process.env.FLUJO_ORCHESTRATION_MODE = "parallel";
    const started: string[] = [];

    vi.mocked(buscarPorId).mockResolvedValue({ id: 1 } as never);

    vi.mocked(obtenerHabitacion).mockImplementation(async () => {
      started.push("hotel-start");
      await new Promise((r) => setTimeout(r, 30));
      started.push("hotel-end");
      return {
        id: 2,
        numeroHabitacion: "101",
        precioHabitacion: 100,
        estadoHabitacion: "ok",
        tipoHabitacion: "std",
      };
    });

    vi.mocked(obtenerPelicula).mockImplementation(async () => {
      started.push("cine-start");
      await new Promise((r) => setTimeout(r, 5));
      started.push("cine-end");
      return {
        id: 3,
        nombre: "Film",
        duracion: 90,
        genero: "demo",
        descripcion: "d",
      };
    });

    await ejecutar({
      torneoId: 1,
      habitacionId: 2,
      peliculaId: 3,
      traceId: "trace-par-1",
    });

    expect(started[0]).toBe("hotel-start");
    expect(started[1]).toBe("cine-start");
  });
});
