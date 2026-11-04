import { Torneo } from "../entities/Torneo";
import { buscarPorId as buscarTorneoPorId } from "./torneo.service";

const MS_PER_DAY = 86_400_000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class TorneoResumenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TorneoResumenError";
  }
}

export type TorneoResumen = {
  id: number;
  nombre: string;
  deporte: string;
  estado: string;
  fechaInicio: string;
  fechaFin: string;
  duracionDias: number;
};

/**
 * Duración inclusiva en días calendario UTC:
 * (fechaFin - fechaInicio) + 1.
 */
export function calcularDuracionDiasInclusiva(
  fechaInicio: string,
  fechaFin: string,
): number {
  const inicioMs = utcMidnightMs(fechaInicio);
  const finMs = utcMidnightMs(fechaFin);

  if (finMs < inicioMs) {
    throw new TorneoResumenError(
      "fechaFin es anterior a fechaInicio",
    );
  }

  const duracionDias = Math.round((finMs - inicioMs) / MS_PER_DAY) + 1;

  if (!Number.isFinite(duracionDias) || duracionDias < 1) {
    throw new TorneoResumenError("duración inválida");
  }

  return duracionDias;
}

export async function obtenerResumen(
  torneoId: number,
): Promise<TorneoResumen | null> {
  const torneo = await buscarTorneoPorId(torneoId);

  if (!torneo) {
    return null;
  }

  return buildResumen(torneo);
}

export function buildResumen(torneo: Torneo): TorneoResumen {
  const fechaInicio = toDateOnlyString(torneo.fechaInicio);
  const fechaFin = toDateOnlyString(torneo.fechaFin);
  const duracionDias = calcularDuracionDiasInclusiva(fechaInicio, fechaFin);

  return {
    id: torneo.id,
    nombre: torneo.nombre,
    deporte: torneo.deporte,
    estado: torneo.estado,
    fechaInicio,
    fechaFin,
    duracionDias,
  };
}

function toDateOnlyString(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TorneoResumenError("fecha inválida");
    }

    return formatUtcDateOnly(value);
  }

  if (typeof value !== "string") {
    throw new TorneoResumenError("fecha inválida");
  }

  const trimmed = value.trim();

  // mysql2 a veces entrega "YYYY-MM-DD HH:mm:ss"; nos quedamos con la fecha.
  const datePart = trimmed.includes("T")
    ? trimmed.slice(0, 10)
    : trimmed.includes(" ")
      ? trimmed.slice(0, 10)
      : trimmed;

  assertValidDateOnly(datePart);
  return datePart;
}

function utcMidnightMs(dateOnly: string): number {
  const { year, month, day } = assertValidDateOnly(dateOnly);
  return Date.UTC(year, month - 1, day);
}

function assertValidDateOnly(dateOnly: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_ONLY_PATTERN.exec(dateOnly);

  if (!match) {
    throw new TorneoResumenError("fecha inválida");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new TorneoResumenError("fecha inválida");
  }

  return { year, month, day };
}

function formatUtcDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
