import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";

import {
  FAULT_INJECTION_TARGET_ROUTE,
  FAULT_MODE_ERROR,
  FAULT_MODE_HEADER,
  FAULT_TOKEN_HEADER,
  isFaultInjectionArmed,
  secureTokenEquals,
  type FaultInjectionConfig,
} from "../config/fault-injection";
import type { RuntimeIdentity } from "../config/runtime-identity";
import { resolveHttpRoute } from "../observability/metrics";

const FORBIDDEN_BODY = { message: "Acceso denegado" };
const INJECTED_ERROR_BODY = { message: "Error interno simulado" };

/**
 * preHandler para GET /api/v2/torneos/:id.
 * Corta antes del controlador (sin MySQL) cuando la inyección está autorizada.
 * No registra tokens ni cabeceras sensibles.
 */
export function createTorneoLookupFaultPreHandler(
  identity: RuntimeIdentity,
  config: FaultInjectionConfig,
): preHandlerAsyncHookHandler {
  return async function torneoLookupFaultPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (request.method !== "GET") {
      return;
    }

    if (resolveHttpRoute(request) !== FAULT_INJECTION_TARGET_ROUTE) {
      return;
    }

    const mode = singleHeader(request.headers[FAULT_MODE_HEADER]);

    if (mode !== FAULT_MODE_ERROR) {
      return;
    }

    // Stable / disabled / token de entorno inválido: ignorar cabeceras de prueba.
    if (!isFaultInjectionArmed(identity, config)) {
      return;
    }

    const provided = singleHeader(request.headers[FAULT_TOKEN_HEADER]);
    const expected = config.token;

    if (
      provided === undefined ||
      expected === null ||
      !secureTokenEquals(provided, expected)
    ) {
      return reply.code(403).send(FORBIDDEN_BODY);
    }

    return reply.code(500).send(INJECTED_ERROR_BODY);
  };
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  return undefined;
}
