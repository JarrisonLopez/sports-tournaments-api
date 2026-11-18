export type FlujoOrchestrationMode = "sequential" | "parallel";

/**
 * Modo del flujo multicloud evaluado en Seguimiento #4.
 * sequential (default): Hotel → espera → Cine → espera → (artifact opcional).
 * parallel: conserva el comportamiento histórico Promise.all (compatibilidad).
 */
export function resolveFlujoOrchestrationMode(
  env: NodeJS.ProcessEnv = process.env,
): FlujoOrchestrationMode {
  const raw = (env.FLUJO_ORCHESTRATION_MODE ?? "sequential").trim().toLowerCase();

  if (raw === "parallel") {
    return "parallel";
  }

  return "sequential";
}
