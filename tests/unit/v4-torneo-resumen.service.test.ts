import { describe, expect, it } from "vitest";

import {
  buildResumen,
  calcularDuracionDiasInclusiva,
  TorneoResumenError,
} from "../../src/services/v4-torneo-resumen.service";
import { Torneo } from "../../src/entities/Torneo";

describe("calcularDuracionDiasInclusiva", () => {
  it("cuenta un día cuando inicio y fin coinciden", () => {
    expect(calcularDuracionDiasInclusiva("2026-09-01", "2026-09-01")).toBe(1);
  });

  it("cuenta dos días en días consecutivos", () => {
    expect(calcularDuracionDiasInclusiva("2026-09-01", "2026-09-02")).toBe(2);
  });

  it("cuenta la duración inclusiva del ejemplo de rúbrica", () => {
    expect(calcularDuracionDiasInclusiva("2026-09-01", "2026-09-15")).toBe(15);
  });

  it("cruza meses correctamente", () => {
    expect(calcularDuracionDiasInclusiva("2026-01-30", "2026-02-02")).toBe(4);
  });

  it("cruza febrero en año bisiesto", () => {
    expect(calcularDuracionDiasInclusiva("2024-02-28", "2024-03-01")).toBe(3);
  });

  it("rechaza fechas invertidas", () => {
    expect(() =>
      calcularDuracionDiasInclusiva("2026-09-15", "2026-09-01"),
    ).toThrow(TorneoResumenError);
  });

  it("rechaza fechas inválidas sin normalizar", () => {
    expect(() =>
      calcularDuracionDiasInclusiva("2026-02-30", "2026-03-01"),
    ).toThrow(TorneoResumenError);

    expect(() =>
      calcularDuracionDiasInclusiva("no-es-fecha", "2026-09-01"),
    ).toThrow(TorneoResumenError);
  });
});

describe("buildResumen", () => {
  it("arma el contrato con duración inclusiva", () => {
    const torneo = {
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      estado: "PROGRAMADO",
    } as Torneo;

    expect(buildResumen(torneo)).toEqual({
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      estado: "PROGRAMADO",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      duracionDias: 15,
    });
  });

  it("acepta Date UTC de TypeORM/mysql2", () => {
    const torneo = {
      id: 2,
      nombre: "Copa",
      deporte: "Tenis",
      fechaInicio: new Date(Date.UTC(2026, 8, 1)),
      fechaFin: new Date(Date.UTC(2026, 8, 2)),
      estado: "PROGRAMADO",
    } as unknown as Torneo;

    expect(buildResumen(torneo)).toEqual({
      id: 2,
      nombre: "Copa",
      deporte: "Tenis",
      estado: "PROGRAMADO",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-02",
      duracionDias: 2,
    });
  });

  it("falla ante rango invertido persistido", () => {
    const torneo = {
      id: 3,
      nombre: "Inconsistente",
      deporte: "Futbol",
      fechaInicio: "2026-09-15",
      fechaFin: "2026-09-01",
      estado: "PROGRAMADO",
    } as Torneo;

    expect(() => buildResumen(torneo)).toThrow(TorneoResumenError);
  });
});
