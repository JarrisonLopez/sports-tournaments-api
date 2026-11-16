export type ResilienceConfig = {
  enabled: boolean;
  hotelTimeoutMs: number;
  circuitFailureThreshold: number;
  circuitSuccessThreshold: number;
  circuitOpenMs: number;
};

export function resolveResilienceConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResilienceConfig {
  return {
    enabled: env.RESILIENCE_ENABLED === "true",
    hotelTimeoutMs: positiveInt(env.HOTEL_TIMEOUT_MS, 2000),
    circuitFailureThreshold: positiveInt(env.HOTEL_CB_FAILURE_THRESHOLD, 3),
    circuitSuccessThreshold: positiveInt(env.HOTEL_CB_SUCCESS_THRESHOLD, 1),
    circuitOpenMs: positiveInt(env.HOTEL_CB_OPEN_MS, 10_000),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}
