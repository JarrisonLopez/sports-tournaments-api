import { recordChaosFaultEvent } from "../observability/chaos-metrics";

export type HotelLatencyFaultState = {
  enabled: boolean;
  latencyMs: number;
  expiresAt: number | null;
  activatedAt: number | null;
  tokenConfigured: boolean;
  /** Dónde se aplica el delay: cliente HTTP saliente de Sports (no el servidor Hotel). */
  injectionPoint: "sports-outbound-hotel-client";
  /** Base URL efectiva de Hotel al armar (p. ej. OCI real). */
  targetBaseUrl: string | null;
  /** true si el destino no parece un mock de laboratorio. */
  targetsRealHotel: boolean;
};

export type HotelLatencyFaultConfig = {
  labEnabled: boolean;
  token: string | null;
  maxLatencyMs: number;
  maxTtlMs: number;
};

const MIN_TOKEN_LENGTH = 32;
const DEFAULT_MAX_LATENCY_MS = 10_000;
const DEFAULT_MAX_TTL_MS = 120_000;

let state: {
  latencyMs: number;
  expiresAt: number | null;
  activatedAt: number | null;
  targetBaseUrl: string | null;
} = {
  latencyMs: 0,
  expiresAt: null,
  activatedAt: null,
  targetBaseUrl: null,
};

function resolveHotelTargetBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.HOTEL_API_URL?.trim() ?? "";
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function isRealHotelTarget(baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  if (lower.includes("hotel-mock")) return false;
  if (lower.includes("127.0.0.1") || lower.includes("localhost")) return false;
  return true;
}

export function resolveHotelLatencyFaultConfig(
  env: NodeJS.ProcessEnv = process.env,
): HotelLatencyFaultConfig {
  const tokenRaw = env.CHAOS_FAULT_TOKEN?.trim() ?? "";
  const token = tokenRaw.length >= MIN_TOKEN_LENGTH ? tokenRaw : null;

  return {
    labEnabled: env.CHAOS_LAB_ENABLED === "true",
    token,
    maxLatencyMs: Number(env.CHAOS_MAX_LATENCY_MS ?? DEFAULT_MAX_LATENCY_MS),
    maxTtlMs: Number(env.CHAOS_MAX_TTL_MS ?? DEFAULT_MAX_TTL_MS),
  };
}

export function getHotelLatencyFaultState(
  now = Date.now(),
  config: HotelLatencyFaultConfig = resolveHotelLatencyFaultConfig(),
): HotelLatencyFaultState {
  expireIfNeeded(now);

  const targetBaseUrl = state.targetBaseUrl ?? resolveHotelTargetBaseUrl();
  return {
    enabled: isFaultActive(now),
    latencyMs: state.latencyMs,
    expiresAt: state.expiresAt,
    activatedAt: state.activatedAt,
    tokenConfigured: config.token !== null && config.labEnabled,
    injectionPoint: "sports-outbound-hotel-client",
    targetBaseUrl,
    targetsRealHotel: isRealHotelTarget(targetBaseUrl),
  };
}

export function activateHotelLatencyFault(input: {
  token: string;
  latencyMs: number;
  ttlMs: number;
  config?: HotelLatencyFaultConfig;
  now?: number;
}): HotelLatencyFaultState {
  const config = input.config ?? resolveHotelLatencyFaultConfig();
  const now = input.now ?? Date.now();

  assertLabArmed(config, input.token);

  if (
    !Number.isFinite(input.latencyMs) ||
    input.latencyMs <= 0 ||
    input.latencyMs > config.maxLatencyMs
  ) {
    throw new ChaosFaultValidationError(
      `latencyMs fuera de rango (1..${config.maxLatencyMs})`,
    );
  }

  if (
    !Number.isFinite(input.ttlMs) ||
    input.ttlMs <= 0 ||
    input.ttlMs > config.maxTtlMs
  ) {
    throw new ChaosFaultValidationError(
      `ttlMs fuera de rango (1..${config.maxTtlMs})`,
    );
  }

  const targetBaseUrl = resolveHotelTargetBaseUrl();
  state = {
    latencyMs: Math.floor(input.latencyMs),
    expiresAt: now + Math.floor(input.ttlMs),
    activatedAt: now,
    targetBaseUrl,
  };

  recordChaosFaultEvent("start", {
    target: "hotel",
    latency_ms: String(state.latencyMs),
    target_base_url: targetBaseUrl ?? "unset",
    targets_real_hotel: String(isRealHotelTarget(targetBaseUrl)),
    injection_point: "sports-outbound-hotel-client",
  });

  return getHotelLatencyFaultState(now, config);
}

/**
 * Reversión idempotente: apagar el fallo aunque ya estuviera inactivo.
 */
export function deactivateHotelLatencyFault(
  reason: "end" | "abort" | "expire" = "end",
): HotelLatencyFaultState {
  const wasActive = state.latencyMs > 0 && state.expiresAt !== null;
  state = {
    latencyMs: 0,
    expiresAt: null,
    activatedAt: null,
    targetBaseUrl: null,
  };

  if (wasActive || reason !== "end") {
    recordChaosFaultEvent(reason, { target: "hotel" });
  }

  return getHotelLatencyFaultState();
}

export async function applyHotelLatencyIfActive(
  now = Date.now(),
  signal?: AbortSignal,
): Promise<number> {
  expireIfNeeded(now);
  if (!isFaultActive(now)) {
    return 0;
  }

  const delay = state.latencyMs;
  await delayWithOptionalAbort(delay, signal);
  return delay;
}

function delayWithOptionalAbort(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function resetHotelLatencyFaultForTests(): void {
  state = {
    latencyMs: 0,
    expiresAt: null,
    activatedAt: null,
    targetBaseUrl: null,
  };
}

function isFaultActive(now: number): boolean {
  return state.latencyMs > 0 && state.expiresAt !== null && now < state.expiresAt;
}

function expireIfNeeded(now: number): void {
  if (state.expiresAt !== null && now >= state.expiresAt) {
    deactivateHotelLatencyFault("expire");
  }
}

function assertLabArmed(
  config: HotelLatencyFaultConfig,
  providedToken: string,
): void {
  if (!config.labEnabled || config.token === null) {
    throw new ChaosFaultForbiddenError(
      "laboratorio de caos no armado (CHAOS_LAB_ENABLED/token)",
    );
  }

  if (providedToken !== config.token) {
    throw new ChaosFaultForbiddenError("token de caos inválido");
  }
}

export class ChaosFaultForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChaosFaultForbiddenError";
  }
}

export class ChaosFaultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChaosFaultValidationError";
  }
}
