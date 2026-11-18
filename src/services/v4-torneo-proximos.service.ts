import {
  buscarProximos,
  type FilaTorneoProximo,
} from "./torneo.service";

export const PROXIMOS_LIMITE_PREDETERMINADO = 20;
export const PROXIMOS_LIMITE_MAXIMO = 50;

const LIMITE_PATTERN = /^[1-9]\d*$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class TorneoProximosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TorneoProximosError";
  }
}

export type TorneoProximo = {
  id: number;
  nombre: string;
  deporte: string;
  estado: string;
  fechaInicio: string;
  fechaFin: string;
};

/**
 * Fecha de calendario UTC (YYYY-MM-DD). No usa la zona local del proceso.
 */
export function fechaCalendarioUtc(ahora: Date = new Date()): string {
  if (Number.isNaN(ahora.getTime())) {
    throw new TorneoProximosError("fecha de referencia inválida");
  }

  const year = ahora.getUTCFullYear();
  const month = String(ahora.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ahora.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * undefined = límite predeterminado.
 * null = parámetro presente pero inválido.
 */
export function parseLimite(
  raw: unknown,
): number | undefined | null {
  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== "string" || !LIMITE_PATTERN.test(raw)) {
    return null;
  }

  const limite = Number(raw);

  if (limite > PROXIMOS_LIMITE_MAXIMO) {
    return null;
  }

  return limite;
}

export async function listarProximos(opciones: {
  limite?: number;
  ahora?: Date;
} = {}): Promise<TorneoProximo[]> {
  const limite = opciones.limite ?? PROXIMOS_LIMITE_PREDETERMINADO;
  const fechaInicioDesde = fechaCalendarioUtc(opciones.ahora);
  const torneos = await buscarProximos({ fechaInicioDesde, limite });

  return torneos.map(toTorneoProximo);
}

function toTorneoProximo(torneo: FilaTorneoProximo): TorneoProximo {
  const id = Number(torneo.id);

  if (!Number.isInteger(id)) {
    throw new TorneoProximosError("identificador inválido");
  }

  return {
    id,
    nombre: torneo.nombre,
    deporte: torneo.deporte,
    estado: torneo.estado,
    fechaInicio: toDateOnlyString(torneo.fechaInicio),
    fechaFin: toDateOnlyString(torneo.fechaFin),
  };
}

function toDateOnlyString(value: string | Date): string {
  if (value instanceof Date) {
    throw new TorneoProximosError("fecha inválida");
  }

  if (typeof value !== "string") {
    throw new TorneoProximosError("fecha inválida");
  }

  const trimmed = value.trim();
  const datePart = trimmed.includes("T")
    ? trimmed.slice(0, 10)
    : trimmed.includes(" ")
      ? trimmed.slice(0, 10)
      : trimmed;

  if (!DATE_ONLY_PATTERN.test(datePart)) {
    throw new TorneoProximosError("fecha inválida");
  }

  return datePart;
}
