export interface HabitacionRemota {
  id: number;
  numeroHabitacion: string;
  precioHabitacion: number;
  estadoHabitacion: string;
  tipoHabitacion: string;
}

export async function obtenerHabitacion(
  habitacionId: number,
  traceId: string,
): Promise<HabitacionRemota> {
  const hotelApiUrl = process.env.HOTEL_API_URL;

  if (!hotelApiUrl) {
    throw new Error("HOTEL_API_URL no está configurada");
  }

  const response = await fetch(
    `${hotelApiUrl}/api/v2/habitacion/${habitacionId}`,
    {
      headers: {
        "x-trace-id": traceId,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Error consultando Habitación: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as HabitacionRemota;
}