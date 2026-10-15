import { trace } from "@opentelemetry/api";
import { FastifyReply, FastifyRequest } from "fastify";

import {
  ArtifactNotFoundError,
  BucketNotConfiguredError,
  FlowArtifact,
  isBucketConfigured,
  readArtifact,
  saveArtifact,
} from "../services/artifact-storage.service";

const TRACE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function isValidTraceId(value: unknown): value is string {
  return typeof value === "string" && TRACE_ID_PATTERN.test(value);
}

function headerTraceId(request: FastifyRequest): string | undefined {
  const value = request.headers["x-trace-id"];

  return typeof value === "string" ? value : undefined;
}

function optionalOrigen(body: object): string | undefined | null {
  if (!Object.hasOwn(body, "origen")) {
    return undefined;
  }

  const origen = (body as { origen: unknown }).origen;

  if (typeof origen !== "string" || origen.trim() === "") {
    return null;
  }

  return origen;
}

type ClassifiedArtifact =
  | {
      kind: "v2";
      traceId: unknown;
      torneo: unknown;
      habitacion: unknown;
      pelicula: unknown;
    }
  | {
      kind: "v3";
      traceId: unknown;
      torneo: unknown;
    };

function classifyArtifact(body: unknown): ClassifiedArtifact | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  if (!Object.hasOwn(body, "traceId") || !Object.hasOwn(body, "torneo")) {
    return null;
  }

  const record = body as {
    traceId: unknown;
    torneo: unknown;
    habitacion?: unknown;
    pelicula?: unknown;
  };
  const hasHabitacion = Object.hasOwn(body, "habitacion");
  const hasPelicula = Object.hasOwn(body, "pelicula");

  if (hasHabitacion && hasPelicula) {
    return {
      kind: "v2",
      traceId: record.traceId,
      torneo: record.torneo,
      habitacion: record.habitacion,
      pelicula: record.pelicula,
    };
  }

  if (!hasHabitacion && !hasPelicula) {
    return {
      kind: "v3",
      traceId: record.traceId,
      torneo: record.torneo,
    };
  }

  return null;
}

function bindTraceLog(
  request: FastifyRequest,
  reply: FastifyReply,
  traceId: string,
): void {
  const bindings: Record<string, string> = { traceId };
  const span = trace.getActiveSpan();

  if (span) {
    const spanContext = span.spanContext();

    if (trace.isSpanContextValid(spanContext)) {
      bindings.otelTraceId = spanContext.traceId;
      bindings.otelSpanId = spanContext.spanId;
    }
  }

  const tracedLog = request.log.child(bindings);
  request.log = tracedLog;
  reply.log = tracedLog;
}

function sendStorageError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  traceId: string,
) {
  request.log.error({ err: error }, "Error de almacenamiento");

  const statusCode = error instanceof BucketNotConfiguredError ? 503 : 502;

  return reply.code(statusCode).header("x-trace-id", traceId).send({
    message: "Error de almacenamiento",
  });
}

export async function createArtifact(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const traceId = headerTraceId(request);

  if (traceId === undefined) {
    return reply.code(400).send({
      message: "El header x-trace-id es obligatorio",
    });
  }

  if (!isValidTraceId(traceId)) {
    return reply.code(400).send({
      message: "El trace id no es válido",
    });
  }

  bindTraceLog(request, reply, traceId);

  const body = request.body;

  const classified = classifyArtifact(body);

  if (!classified) {
    return reply.code(400).send({
      message: "El artifact no contiene los campos requeridos",
    });
  }

  if (!isValidTraceId(classified.traceId)) {
    return reply.code(400).send({
      message: "El trace id no es válido",
    });
  }

  if (traceId !== classified.traceId) {
    return reply.code(400).send({
      message: "El x-trace-id no coincide con traceId del artifact",
    });
  }

  const origen = optionalOrigen(body as object);

  if (origen === null) {
    return reply.code(400).send({
      message: "El origen no es válido",
    });
  }

  const artifact: FlowArtifact =
    classified.kind === "v2"
      ? {
          traceId: classified.traceId,
          ...(origen !== undefined ? { origen } : {}),
          torneo: classified.torneo,
          habitacion: classified.habitacion,
          pelicula: classified.pelicula,
        }
      : {
          traceId: classified.traceId,
          ...(origen !== undefined ? { origen } : {}),
          torneo: classified.torneo,
        };

  try {
    if (!isBucketConfigured()) {
      throw new BucketNotConfiguredError();
    }

    const reference = await saveArtifact(artifact);

    return reply.code(201).header("x-trace-id", traceId).send(reference);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      return reply.code(404).header("x-trace-id", traceId).send({
        message: "Artifact no encontrado",
      });
    }

    return sendStorageError(request, reply, error, traceId);
  }
}

export async function getArtifact(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const traceId = headerTraceId(request);
  const { traceId: requestedTraceId } = request.params as {
    traceId: string;
  };

  if (traceId === undefined) {
    return reply.code(400).send({
      message: "El header x-trace-id es obligatorio",
    });
  }

  if (!isValidTraceId(traceId)) {
    return reply.code(400).send({
      message: "El trace id no es válido",
    });
  }

  bindTraceLog(request, reply, traceId);

  if (!isValidTraceId(requestedTraceId)) {
    return reply.code(400).send({
      message: "El trace id no es válido",
    });
  }

  if (traceId !== requestedTraceId) {
    return reply.code(400).send({
      message: "El x-trace-id no coincide con traceId del artifact",
    });
  }

  try {
    if (!isBucketConfigured()) {
      throw new BucketNotConfiguredError();
    }

    const artifact = await readArtifact(traceId);

    return reply.code(200).header("x-trace-id", traceId).send(artifact);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      return reply.code(404).header("x-trace-id", traceId).send({
        message: "Artifact no encontrado",
      });
    }

    return sendStorageError(request, reply, error, traceId);
  }
}
