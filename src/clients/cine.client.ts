import { SpanStatusCode, trace } from "@opentelemetry/api";

import { buildOutboundTraceHeaders } from "./http-trace";

export interface PeliculaRemota {
  id: number;
  nombre: string;
  duracion: number;
  genero: string;
  descripcion: string;
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

        return (await response.json()) as PeliculaRemota;
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
