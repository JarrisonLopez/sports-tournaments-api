/**
 * Identidad de runtime para Canary (headers X-Api-Version / X-Api-Track).
 *
 * Fuentes de verdad: solo API_VERSION y API_TRACK del entorno (o overrides en tests).
 * No se lee package.json: su "version" (hoy 1.0.0) no coincide con releases SemVer ni con
 * la superficie HTTP (/api/v3).
 *
 * Ausencia (local): ambos valores resuelven a "unset". No se asume "stable" ni "canary".
 * Track inválido (distinto de stable|canary): "invalid".
 */

export const API_VERSION_HEADER = "x-api-version";
export const API_TRACK_HEADER = "x-api-track";

export const UNSET_IDENTITY_VALUE = "unset";
export const INVALID_TRACK_VALUE = "invalid";

export const ALLOWED_API_TRACKS = ["stable", "canary"] as const;

export type AllowedApiTrack = (typeof ALLOWED_API_TRACKS)[number];

export type RuntimeIdentity = {
  version: string;
  track: string;
};

export function resolveRuntimeIdentity(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeIdentity {
  return {
    version: resolveApiVersion(env.API_VERSION),
    track: resolveApiTrack(env.API_TRACK),
  };
}

function resolveApiVersion(raw: string | undefined): string {
  if (typeof raw !== "string") {
    return UNSET_IDENTITY_VALUE;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return UNSET_IDENTITY_VALUE;
  }

  return trimmed;
}

function resolveApiTrack(raw: string | undefined): string {
  if (typeof raw !== "string") {
    return UNSET_IDENTITY_VALUE;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return UNSET_IDENTITY_VALUE;
  }

  if (trimmed === "stable" || trimmed === "canary") {
    return trimmed;
  }

  return INVALID_TRACK_VALUE;
}
