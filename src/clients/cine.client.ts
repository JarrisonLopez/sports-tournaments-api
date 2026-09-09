export interface PeliculaRemota {
  id: number;
  nombre: string;
  duracion: number;
  genero: string;
  descripcion: string;
}

export async function obtenerPelicula(
  peliculaId: number,
  traceId: string,
): Promise<PeliculaRemota> {
  const cineApiUrl = process.env.CINE_API_URL;

  if (!cineApiUrl) {
    throw new Error("CINE_API_URL no está configurada");
  }

  const response = await fetch(
    `${cineApiUrl}/api/v2/peliculas/${peliculaId}`,
    {
      headers: {
        "x-trace-id": traceId,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Error consultando Película: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as PeliculaRemota;
}