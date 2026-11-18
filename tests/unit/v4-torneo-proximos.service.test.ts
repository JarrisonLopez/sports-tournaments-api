import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  buscarProximos: vi.fn(),
}));

import { Torneo } from "../../src/entities/Torneo";
import { buscarProximos } from "../../src/services/torneo.service";
import {
  fechaCalendarioUtc,
  listarProximos,
  parseLimite,
  PROXIMOS_LIMITE_MAXIMO,
  PROXIMOS_LIMITE_PREDETERMINADO,
  TorneoProximosError,
} from "../../src/services/v4-torneo-proximos.service";

const hoy = new Date("2026-11-05T15:00:00.000Z");

function torneo(parcial: Partial<Torneo> & Pick<Torneo, "id" | "fechaInicio">): Torneo {
  return {
    id: parcial.id,
    nombre: parcial.nombre ?? `Torneo ${parcial.id}`,
    deporte: parcial.deporte ?? "Futbol",
    estado: parcial.estado ?? "PROGRAMADO",
    fechaInicio: parcial.fechaInicio,
    fechaFin: parcial.fechaFin ?? "2026-11-20",
  } as Torneo;
}

describe("fechaCalendarioUtc", () => {
  it("usa el calendario UTC y no la zona local", () => {
    expect(fechaCalendarioUtc(new Date("2026-11-05T03:30:00.000Z"))).toBe(
      "2026-11-05",
    );
    expect(fechaCalendarioUtc(new Date("2026-11-06T04:30:00.000Z"))).toBe(
      "2026-11-06",
    );
  });
});

describe("parseLimite", () => {
  it("omite el límite cuando no viene el parámetro", () => {
    expect(parseLimite(undefined)).toBeUndefined();
  });

  it("acepta un entero dentro del máximo", () => {
    expect(parseLimite("1")).toBe(1);
    expect(parseLimite(String(PROXIMOS_LIMITE_MAXIMO))).toBe(
      PROXIMOS_LIMITE_MAXIMO,
    );
  });

  it("rechaza cero, negativos, decimales, texto y valores excesivos", () => {
    expect(parseLimite("0")).toBeNull();
    expect(parseLimite("-1")).toBeNull();
    expect(parseLimite("1.5")).toBeNull();
    expect(parseLimite("abc")).toBeNull();
    expect(parseLimite(String(PROXIMOS_LIMITE_MAXIMO + 1))).toBeNull();
    expect(parseLimite(["10"])).toBeNull();
  });
});

describe("listarProximos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filtra desde hoy UTC, ordena en SQL y aplica el límite predeterminado", async () => {
    vi.mocked(buscarProximos).mockResolvedValue([
      torneo({ id: 2, fechaInicio: "2026-11-05", fechaFin: "2026-11-06" }),
      torneo({ id: 7, fechaInicio: "2026-11-08", fechaFin: "2026-11-09" }),
    ]);

    const resultado = await listarProximos({ ahora: hoy });

    expect(buscarProximos).toHaveBeenCalledTimes(1);
    expect(buscarProximos).toHaveBeenCalledWith({
      fechaInicioDesde: "2026-11-05",
      limite: PROXIMOS_LIMITE_PREDETERMINADO,
    });
    expect(resultado.map((item) => item.id)).toEqual([2, 7]);
    expect(resultado[0]).toEqual({
      id: 2,
      nombre: "Torneo 2",
      deporte: "Futbol",
      estado: "PROGRAMADO",
      fechaInicio: "2026-11-05",
      fechaFin: "2026-11-06",
    });
  });

  it("conserva strings de calendario y rechaza Date ambiguo", async () => {
    vi.mocked(buscarProximos).mockResolvedValue([
      torneo({
        id: 3,
        fechaInicio: "2026-11-05",
        fechaFin: "2026-11-12 00:00:00",
      }),
    ]);

    const resultado = await listarProximos({ ahora: hoy, limite: 5 });

    expect(resultado[0]?.fechaInicio).toBe("2026-11-05");
    expect(resultado[0]?.fechaFin).toBe("2026-11-12");
    expect(buscarProximos).toHaveBeenCalledWith({
      fechaInicioDesde: "2026-11-05",
      limite: 5,
    });

    vi.mocked(buscarProximos).mockResolvedValue([
      torneo({
        id: 3,
        fechaInicio: new Date(2026, 10, 5),
        fechaFin: "2026-11-12",
      }),
    ]);

    await expect(listarProximos({ ahora: hoy })).rejects.toBeInstanceOf(
      TorneoProximosError,
    );
  });

  it("devuelve colección vacía cuando la consulta no trae filas", async () => {
    vi.mocked(buscarProximos).mockResolvedValue([]);

    await expect(listarProximos({ ahora: hoy })).resolves.toEqual([]);
  });

  it("propaga fechas inválidas como error controlado", async () => {
    vi.mocked(buscarProximos).mockResolvedValue([
      torneo({ id: 1, fechaInicio: "no-fecha" }),
    ]);

    await expect(listarProximos({ ahora: hoy })).rejects.toBeInstanceOf(
      TorneoProximosError,
    );
  });
});
