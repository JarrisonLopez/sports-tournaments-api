import { SpanStatusCode, trace } from "@opentelemetry/api";

import { applyHotelLatencyIfActive } from "../chaos/hotel-latency-fault";
import {
  getHotelCircuitBreaker,
  resetHotelCircuitBreakerForTests,
} from "../resilience/circuit-breaker";
import { resolveResilienceConfig } from "../resilience/config";
import { withTimeout } from "../resilience/timeout";
import { buildOutboundTraceHeaders } from "./http-trace";

export { resetHotelCircuitBreakerForTests };

export interface HabitacionRemota {
  id: number;
  numeroHabitacion: string;
  precioHabitacion: number;
  estadoHabitacion: string;
  tipoHabitacion: string;
}

export class HotelConfigError extends Error {
  constructor() {
    super("HOTEL_API_URL no está configurada");
    this.name = "HotelConfigError";
  }
}

export class HotelRequestError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Error consultando Habitación: ${status} ${statusText}`);
    this.name = "HotelRequestError";
    this.status = status;
  }
}

export type HotelClientDeps = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Hook de laboratorio para inyectar latencia antes del fetch (chaos). */
  beforeRequest?: () => Promise<void>;
};

const tracer = trace.getTracer("sports-api");

export async function obtenerHabitacion(
  habitacionId: number,
  traceId: string,
  deps: HotelClientDeps = {},
): Promise<HabitacionRemota> {
  const env = deps.env ?? process.env;
  const hotelApiUrl = env.HOTEL_API_URL;
  const doFetch = deps.fetch ?? fetch;
  const resilience = resolveResilienceConfig(env);

  if (!hotelApiUrl || hotelApiUrl.trim() === "") {
    throw new HotelConfigError();
  }

  const baseUrl = hotelApiUrl.trim().replace(/\/+$/, "");
  const url = `${baseUrl}/api/v2/habitacion/${habitacionId}`;

  const invoke = async (): Promise<HabitacionRemota> =>
    tracer.startActiveSpan(
      "hotel.get_habitacion",
      {
        attributes: {
          "peer.service": "hotel-api",
          "http.method": "GET",
          "url.full": url,
          "sports.trace_id": traceId,
          "resilience.enabled": resilience.enabled,
        },
      },
      async (span) => {
        try {
          if (deps.beforeRequest) {
            await deps.beforeRequest();
          }

          const callFetch = async (signal?: AbortSignal) => {
            // Latencia de laboratorio dentro del presupuesto de timeout.
            await applyHotelLatencyIfActive(Date.now(), signal);

            const response = await doFetch(url, {
              headers: buildOutboundTraceHeaders(traceId),
              signal,
            });

            span.setAttribute("http.status_code", response.status);

            if (!response.ok) {
              throw new HotelRequestError(response.status, response.statusText);
            }

            return (await response.json()) as HabitacionRemota;
          };

          if (!resilience.enabled) {
            return callFetch();
          }

          return withTimeout(resilience.hotelTimeoutMs, (signal) =>
            callFetch(signal),
          );
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : "hotel error",
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );

  if (!resilience.enabled) {
    return invoke();
  }

  const breaker = getHotelCircuitBreaker({
    failureThreshold: resilience.circuitFailureThreshold,
    successThreshold: resilience.circuitSuccessThreshold,
    openMs: resilience.circuitOpenMs,
    name: "hotel",
  });

  return breaker.exec(invoke);
}
