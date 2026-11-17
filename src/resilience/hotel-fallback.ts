import type { HabitacionRemota } from "../clients/hotel.client";
import { CircuitOpenError } from "./circuit-breaker";
import { HotelTimeoutError } from "./timeout";

/**
 * Fallback de negocio cuando Hotel no responde a tiempo o el circuit breaker está abierto.
 * Entrega una habitación válida para completar el flujo (estado parcial), marcada como degradada.
 */
export function buildHotelFallback(habitacionId: number): HabitacionRemota & {
  origenResiliencia: "fallback";
} {
  return {
    id: habitacionId,
    numeroHabitacion: `FALLBACK-${habitacionId}`,
    precioHabitacion: 0,
    estadoHabitacion: "degradado",
    tipoHabitacion: "fallback",
    origenResiliencia: "fallback",
  };
}

export function isHotelRecoverableError(error: unknown): boolean {
  return (
    error instanceof HotelTimeoutError ||
    error instanceof CircuitOpenError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (((error as { name?: string }).name === "HotelTimeoutError") ||
        (error as { name?: string }).name === "CircuitOpenError"))
  );
}

export function isDegradedHabitacion(
  habitacion: HabitacionRemota,
): habitacion is HabitacionRemota & { origenResiliencia: "fallback" } {
  return (
    typeof habitacion === "object" &&
    habitacion !== null &&
    "origenResiliencia" in habitacion &&
    (habitacion as { origenResiliencia?: string }).origenResiliencia ===
      "fallback"
  );
}
