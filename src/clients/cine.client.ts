import { SpanStatusCode, trace } from "@opentelemetry/api";

import { buildOutboundTraceHeaders } from "./http-trace";

export interface PeliculaRemota {
  id: number;
  nombre: string;
  duracion: number;
  genero: string;
  descripcion: string;
  /** Presente cuando Cine GCP envuelve `{ origen, pelicula }`. */
  origen?: string;
}

export class CineConfigError extends Error {
  constructor() {
    super("CINE_API_URL no está configurada");
    this.name = "CineConfigError";
  }
}

export class CineRequestError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Error consultando Película: ${status} ${statusText}`);
    this.name = "CineRequestError";
    this.status = status;
  }
}

export type CineClientDeps = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

const tracer = trace.getTracer("sports-api");

export async function obtenerPelicula(
  peliculaId: number,
  traceId: string,
  deps: CineClientDeps = {},
): Promise<PeliculaRemota> {
  const env = deps.env ?? process.env;
  const cineApiUrl = env.CINE_API_URL;
  const doFetch = deps.fetch ?? fetch;

  if (!cineApiUrl || cineApiUrl.trim() === "") {
    throw new CineConfigError();
  }

  const baseUrl = cineApiUrl.trim().replace(/\/+$/, "");
  const url = `${baseUrl}/api/v2/peliculas/${peliculaId}`;

  return tracer.startActiveSpan(
    "cine.get_pelicula",
    {
      attributes: {
        "peer.service": "cine-api",
        "http.method": "GET",
        "url.full": url,
        "sports.trace_id": traceId,
      },
    },
    async (span) => {
      try {
        const response = await doFetch(url, {
          headers: buildOutboundTraceHeaders(traceId),
        });

        span.setAttribute("http.status_code", response.status);

        if (!response.ok) {
          throw new CineRequestError(response.status, response.statusText);
        }

        return normalizePeliculaPayload(await response.json());
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "cine error",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Cine GCP (Daniel) responde `{ origen, traceId, pelicula }`.
 * Los mocks de lab responden la película en la raíz. Ambos son válidos.
 */
export function normalizePeliculaPayload(body: unknown): PeliculaRemota {
  if (!body || typeof body !== "object") {
    throw new CineRequestError(502, "payload cine inválido");
  }

  const root = body as Record<string, unknown>;
  const raw =
    root.pelicula && typeof root.pelicula === "object"
      ? (root.pelicula as Record<string, unknown>)
      : root;

  const id = Number(raw.id);
  const duracion = Number(raw.duracion);
  if (!Number.isFinite(id) || !Number.isFinite(duracion)) {
    throw new CineRequestError(502, "campos cine inválidos");
  }

  const pelicula: PeliculaRemota = {
    id,
    nombre: String(raw.nombre ?? ""),
    duracion,
    genero: String(raw.genero ?? ""),
    descripcion: String(raw.descripcion ?? ""),
  };

  if (typeof root.origen === "string" && root.origen.length > 0) {
    pelicula.origen = root.origen;
  }

  return pelicula;
}
