import type { HabitacionRemota } from "../clients/hotel.client";
import { CircuitOpenError } from "./circuit-breaker";
import { HotelTimeoutError } from "./timeout";

/**
 * Fallback de negocio cuando Hotel no responde a tiempo, devuelve 5xx (p. ej. HTTP 503),
 * o el circuit breaker está abierto.
 * Entrega una habitación válida para completar el flujo (estado parcial), marcada como degradada.
 */
export function buildHotelFallback(habitacionId: number): HabitacionRemota & {
  origenResiliencia: "fallback";
} {
  return {
    id: habitacionId,
    numeroHabitacion: `DEG-${habitacionId}`,
    precioHabitacion: 0,
    estadoHabitacion: "degradado-lab",
    tipoHabitacion: "fallback-controlled",
    origenResiliencia: "fallback",
  };
}

/**
 * Errores recuperables con fallback (solo con RESILIENCE_ENABLED + HOTEL_FALLBACK_ENABLED).
 * Incluye timeout, circuit open y HotelRequestError 5xx (indisponibilidad Samuel / HTTP 503).
 * No recupera 4xx (p. ej. 404 habitación inexistente).
 */
export function isHotelRecoverableError(error: unknown): boolean {
  if (error instanceof HotelTimeoutError || error instanceof CircuitOpenError) {
    return true;
  }

  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  const name = (error as { name?: string }).name;
  if (name === "HotelTimeoutError" || name === "CircuitOpenError") {
    return true;
  }

  if (name === "HotelRequestError") {
    const status = (error as { status?: number }).status;
    return typeof status === "number" && status >= 500;
  }

  return false;
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
