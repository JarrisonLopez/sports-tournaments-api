/**
 * Cabeceras de negocio para llamadas salientes.
 * El header W3C `traceparent`/`tracestate` lo inyecta la instrumentación Undici/OTel
 * sobre el contexto activo; aquí solo propagamos el identificador funcional.
 */
export function buildOutboundTraceHeaders(
  traceId: string,
): Record<string, string> {
  return {
    "x-trace-id": traceId,
  };
}
