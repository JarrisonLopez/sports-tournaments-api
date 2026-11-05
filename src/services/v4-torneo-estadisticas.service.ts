import { consultarEstadisticasTorneos } from "./torneo.service";

export class TorneoEstadisticasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TorneoEstadisticasError";
  }
}

export type GrupoDeporte = {
  deporte: string | null;
  cantidad: number;
};

export type GrupoEstado = {
  estado: string | null;
  cantidad: number;
};

export type TorneoEstadisticas = {
  totalTorneos: number;
  porDeporte: GrupoDeporte[];
  porEstado: GrupoEstado[];
};

const CANTIDAD_ENTERA = /^(0|[1-9]\d*)$/;

export function normalizarCantidad(value: unknown): number {
  if (typeof value === "bigint") {
    throw new TorneoEstadisticasError("cantidad inválida");
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TorneoEstadisticasError("cantidad inválida");
    }

    return value;
  }

  if (typeof value === "string" && CANTIDAD_ENTERA.test(value)) {
    const cantidad = Number(value);

    if (!Number.isSafeInteger(cantidad)) {
      throw new TorneoEstadisticasError("cantidad inválida");
    }

    return cantidad;
  }

  throw new TorneoEstadisticasError("cantidad inválida");
}

export async function obtenerEstadisticas(): Promise<TorneoEstadisticas> {
  const raw = await consultarEstadisticasTorneos();
  const porDeporte = ordenarGrupos(
    raw.porDeporte.map((fila) => ({
      deporte: fila.deporte,
      cantidad: normalizarCantidad(fila.cantidad),
    })),
    "deporte",
  );
  const porEstado = ordenarGrupos(
    raw.porEstado.map((fila) => ({
      estado: fila.estado,
      cantidad: normalizarCantidad(fila.cantidad),
    })),
    "estado",
  );

  return {
    totalTorneos: normalizarCantidad(raw.total),
    porDeporte,
    porEstado,
  };
}

function ordenarGrupos<T extends { cantidad: number }>(
  grupos: T[],
  clave: keyof T,
): T[] {
  return [...grupos].sort((left, right) => {
    if (left.cantidad !== right.cantidad) {
      return right.cantidad - left.cantidad;
    }

    return compararCategoria(left[clave], right[clave]);
  });
}

function compararCategoria(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  const textoIzquierdo = String(left);
  const textoDerecho = String(right);

  if (textoIzquierdo < textoDerecho) {
    return -1;
  }

  if (textoIzquierdo > textoDerecho) {
    return 1;
  }

  return 0;
}
