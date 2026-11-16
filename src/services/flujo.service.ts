import { SpanStatusCode, trace } from "@opentelemetry/api";

import { obtenerHabitacion } from "../clients/hotel.client";
import { obtenerPelicula } from "../clients/cine.client";
import { saveArtifact } from "../clients/object-storage.client";
import { resolveFlujoOrchestrationMode } from "../config/flujo-orchestration";
import { buscarPorId as buscarTorneoPorId } from "./torneo.service";

const tracer = trace.getTracer("sports-api");

export type FlujoInput = {
  torneoId: number;
  habitacionId: number;
  peliculaId: number;
  traceId: string;
};

export async function ejecutar(datos: FlujoInput) {
  return tracer.startActiveSpan(
    "flujo.multicloud",
    {
      attributes: {
        "sports.trace_id": datos.traceId,
        "sports.torneo_id": datos.torneoId,
        "sports.habitacion_id": datos.habitacionId,
        "sports.pelicula_id": datos.peliculaId,
      },
    },
    async (span) => {
      try {
        const torneo = await buscarTorneoPorId(datos.torneoId);

        if (!torneo) {
          span.setAttribute("flujo.outcome", "torneo_not_found");
          return null;
        }

        const mode = resolveFlujoOrchestrationMode();
        span.setAttribute("flujo.orchestration_mode", mode);

        let habitacion;
        let pelicula;

        if (mode === "parallel") {
          // Compatibilidad histórica Entrega 2.
          [habitacion, pelicula] = await Promise.all([
            obtenerHabitacion(datos.habitacionId, datos.traceId),
            obtenerPelicula(datos.peliculaId, datos.traceId),
          ]);
        } else {
          // Seguimiento #4: síncrono secuencial Hotel → Cine.
          habitacion = await obtenerHabitacion(
            datos.habitacionId,
            datos.traceId,
          );
          pelicula = await obtenerPelicula(datos.peliculaId, datos.traceId);
        }

        const artifact = {
          traceId: datos.traceId,
          torneo,
          habitacion,
          pelicula,
        };

        const objectStorageConfigured =
          typeof process.env.OBJECT_STORAGE_API_URL === "string" &&
          process.env.OBJECT_STORAGE_API_URL.trim() !== "";

        if (!objectStorageConfigured) {
          span.setAttribute("flujo.artifact", "skipped");
          span.setAttribute("flujo.outcome", "success");
          return {
            ...artifact,
            artifact: null,
          };
        }

        const referencia = await saveArtifact(artifact, datos.traceId);
        span.setAttribute("flujo.artifact", "stored");
        span.setAttribute("flujo.outcome", "success");

        return {
          ...artifact,
          artifact: referencia,
        };
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "flujo error",
        });
        span.setAttribute("flujo.outcome", "error");
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
