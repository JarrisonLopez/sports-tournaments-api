import { context, propagation, trace } from "@opentelemetry/api";

/**
 * Cabeceras de correlación para llamadas salientes al flujo multicloud.
 * Propaga W3C (traceparent/tracestate) desde el contexto activo y el x-trace-id de negocio.
 */
export function buildOutboundTraceHeaders(
  traceId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-trace-id": traceId,
  };

  propagation.inject(context.active(), headers);

  const span = trace.getActiveSpan();
  if (span && trace.isSpanContextValid(span.spanContext())) {
    // Garantiza presencia explícita aunque el propagator no rellene en tests.
    if (!headers.traceparent) {
      const sc = span.spanContext();
      headers.traceparent = `00-${sc.traceId}-${sc.spanId}-01`;
    }
  }

  return headers;
}
