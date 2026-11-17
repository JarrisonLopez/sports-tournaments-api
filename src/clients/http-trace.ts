import { context, propagation } from "@opentelemetry/api";

/**
 * Cabeceras salientes: x-trace-id de negocio + W3C traceparent/tracestate
 * desde el contexto OTel activo (si hay span).
 */
export function buildOutboundTraceHeaders(
  traceId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-trace-id": traceId,
  };

  propagation.inject(context.active(), headers);

  return headers;
}
