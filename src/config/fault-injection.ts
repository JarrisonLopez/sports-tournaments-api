import { createHash, timingSafeEqual } from "node:crypto";

import type { RuntimeIdentity } from "./runtime-identity";

/** Cabecera que solicita el modo de inyección (allowlist: "error"). */
export const FAULT_MODE_HEADER = "x-fault-mode";

/** Cabecera con el token de autorización de inyección. */
export const FAULT_TOKEN_HEADER = "x-fault-token";

export const FAULT_MODE_ERROR = "error";

/**
 * Plantilla Fastify (con prefijo) de la ruta compartida sujeta a inyección.
 * Debe coincidir con la ruta medida por sports.torneo.lookup.success.
 */
export const FAULT_INJECTION_TARGET_ROUTE = "/api/v2/torneos/:id";

/**
 * Longitud mínima del token configurado.
 * Rechaza vacíos y valores manifiestamente cortos; no sustituye un secreto fuerte en Secret Manager.
 */
export const MIN_FAULT_TOKEN_LENGTH = 32;

export type FaultInjectionConfig = {
  /** FAULT_INJECTION_ENABLED === "true" */
  enabled: boolean;
  /**
   * Token normalizado listo para comparar, o null si falta / es inseguro.
   * null ⇒ el mecanismo nunca se arma.
   */
  token: string | null;
};

/**
 * Resuelve la configuración desde un env explícito (tests) o process.env (runtime).
 * No lee API_TRACK: la identidad runtime sigue siendo la única fuente de track.
 */
export function resolveFaultInjectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): FaultInjectionConfig {
  const enabled = env.FAULT_INJECTION_ENABLED === "true";
  const token = normalizeFaultToken(env.FAULT_INJECTION_TOKEN);

  return { enabled, token };
}

/**
 * El mecanismo solo se arma en canary con enable explícito y token válido.
 * IAM run.invoker no forma parte de esta decisión.
 */
export function isFaultInjectionArmed(
  identity: RuntimeIdentity,
  config: FaultInjectionConfig,
): boolean {
  return (
    identity.track === "canary" &&
    config.enabled &&
    typeof config.token === "string" &&
    config.token.length >= MIN_FAULT_TOKEN_LENGTH
  );
}

export function normalizeFaultToken(
  raw: string | undefined,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed.length < MIN_FAULT_TOKEN_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Comparación resistente a timing para tokens de longitud variable:
 * hash SHA-256 de longitud fija + timingSafeEqual.
 */
export function secureTokenEquals(
  provided: string,
  expected: string,
): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(left, right);
}
