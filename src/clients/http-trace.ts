/**
 * Cabeceras de negocio salientes.
 *
 * W3C `traceparent` / `tracestate` los inyecta únicamente
 * `@opentelemetry/instrumentation-undici` sobre el span CLIENT real.
 * No llamar aquí a `propagation.inject`: duplicaría `traceparent`
 * (manual INTERNAL + Undici CLIENT) y Node lo serializa como
 * "tp1, tp2", que es inválido para receptores W3C → Hotel/Cine
 * abren otra traza en Tempo.
 */
export function buildOutboundTraceHeaders(
  traceId: string,
): Record<string, string> {
  return {
    "x-trace-id": traceId,
  };
}
