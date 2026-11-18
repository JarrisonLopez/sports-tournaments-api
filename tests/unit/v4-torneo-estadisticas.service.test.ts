import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  consultarEstadisticasTorneos: vi.fn(),
}));

import { consultarEstadisticasTorneos } from "../../src/services/torneo.service";
import {
  normalizarCantidad,
  obtenerEstadisticas,
  TorneoEstadisticasError,
} from "../../src/services/v4-torneo-estadisticas.service";

describe("normalizarCantidad", () => {
  it("convierte COUNT(*) numérico o string a un entero seguro", () => {
    expect(normalizarCantidad(0)).toBe(0);
    expect(normalizarCantidad(12)).toBe(12);
    expect(normalizarCantidad("0")).toBe(0);
    expect(normalizarCantidad("12")).toBe(12);
  });

  it("rechaza decimales, negativos, vacíos y enteros fuera de rango", () => {
    expect(() => normalizarCantidad("1.5")).toThrow(TorneoEstadisticasError);
    expect(() => normalizarCantidad(-1)).toThrow(TorneoEstadisticasError);
    expect(() => normalizarCantidad("")).toThrow(TorneoEstadisticasError);
    expect(() => normalizarCantidad("9007199254740993")).toThrow(
      TorneoEstadisticasError,
    );
    expect(() => normalizarCantidad(null)).toThrow(TorneoEstadisticasError);
  });
});

describe("obtenerEstadisticas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve ceros cuando no hay torneos", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: "0",
      porDeporte: [],
      porEstado: [],
    });

    await expect(obtenerEstadisticas()).resolves.toEqual({
      totalTorneos: 0,
      porDeporte: [],
      porEstado: [],
    });
  });

  it("agrupa deportes y estados, incluyendo valores distintos de PROGRAMADO", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: "6",
      porDeporte: [
        { deporte: "Tenis", cantidad: "2" },
        { deporte: "Futbol", cantidad: "4" },
      ],
      porEstado: [
        { estado: "FINALIZADO", cantidad: "1" },
        { estado: "PROGRAMADO", cantidad: "4" },
        { estado: "CANCELADO", cantidad: "1" },
      ],
    });

    const resultado = await obtenerEstadisticas();

    expect(resultado.totalTorneos).toBe(6);
    expect(resultado.porDeporte).toEqual([
      { deporte: "Futbol", cantidad: 4 },
      { deporte: "Tenis", cantidad: 2 },
    ]);
    expect(resultado.porEstado).toEqual([
      { estado: "PROGRAMADO", cantidad: 4 },
      { estado: "CANCELADO", cantidad: 1 },
      { estado: "FINALIZADO", cantidad: 1 },
    ]);
    expect(sumar(resultado.porDeporte)).toBe(resultado.totalTorneos);
    expect(sumar(resultado.porEstado)).toBe(resultado.totalTorneos);
  });

  it("conserva categorías nulas o vacías y las ordena sin inventar nombres", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: 3,
      porDeporte: [
        { deporte: "Futbol", cantidad: 1 },
        { deporte: "", cantidad: 1 },
        { deporte: null, cantidad: 1 },
      ],
      porEstado: [
        { estado: null, cantidad: 2 },
        { estado: "PROGRAMADO", cantidad: 1 },
      ],
    });

    const resultado = await obtenerEstadisticas();

    expect(resultado.porDeporte).toEqual([
      { deporte: null, cantidad: 1 },
      { deporte: "", cantidad: 1 },
      { deporte: "Futbol", cantidad: 1 },
    ]);
    expect(resultado.porEstado).toEqual([
      { estado: null, cantidad: 2 },
      { estado: "PROGRAMADO", cantidad: 1 },
    ]);
  });

  it("propaga una cantidad inválida", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: "no-es-numero",
      porDeporte: [],
      porEstado: [],
    });

    await expect(obtenerEstadisticas()).rejects.toBeInstanceOf(
      TorneoEstadisticasError,
    );
  });
});

function sumar(grupos: { cantidad: number }[]): number {
  return grupos.reduce((total, grupo) => total + grupo.cantidad, 0);
}
