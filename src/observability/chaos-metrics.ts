import { Counter, Histogram, UpDownCounter, metrics } from "@opentelemetry/api";

export const FLUJO_REQUESTS_METRIC = "sports.flujo.requests";
export const FLUJO_SUCCESS_METRIC = "sports.flujo.success";
export const FLUJO_ERRORS_METRIC = "sports.flujo.errors";
export const FLUJO_DURATION_METRIC = "sports.flujo.duration";
export const HOTEL_TIMEOUTS_METRIC = "sports.hotel.timeouts";
export const CIRCUIT_BREAKER_STATE_METRIC = "sports.hotel.circuit_breaker.state";
export const CIRCUIT_BREAKER_TRANSITIONS_METRIC =
  "sports.hotel.circuit_breaker.transitions";
export const CHAOS_FAULT_EVENTS_METRIC = "sports.chaos.fault.events";

export type FlujoOutcome = "success" | "error" | "timeout" | "circuit_open";

export type ChaosFaultPhase = "start" | "end" | "abort" | "expire";

export type ChaosMetrics = {
  flujoRequests: Counter;
  flujoSuccess: Counter;
  flujoErrors: Counter;
  flujoDuration: Histogram;
  hotelTimeouts: Counter;
  circuitBreakerState: UpDownCounter;
  circuitBreakerTransitions: Counter;
  chaosFaultEvents: Counter;
};

let cached: ChaosMetrics | undefined;

/**
 * Instrumentos específicos del flujo multicloud y del laboratorio de caos.
 * Reutilizan el MeterProvider global configurado por createHttpMetrics / OTEL.
 */
export function getChaosMetrics(
  meterName = "sports-api-chaos",
): ChaosMetrics {
  if (cached) {
    return cached;
  }

  const meter = metrics.getMeter(meterName);

  cached = {
    flujoRequests: meter.createCounter(FLUJO_REQUESTS_METRIC, {
      description: "Total flujo multicloud requests",
    }),
    flujoSuccess: meter.createCounter(FLUJO_SUCCESS_METRIC, {
      description: "Successful flujo multicloud responses",
    }),
    flujoErrors: meter.createCounter(FLUJO_ERRORS_METRIC, {
      description: "Failed flujo multicloud responses",
    }),
    flujoDuration: meter.createHistogram(FLUJO_DURATION_METRIC, {
      description: "Flujo multicloud end-to-end duration",
      unit: "s",
    }),
    hotelTimeouts: meter.createCounter(HOTEL_TIMEOUTS_METRIC, {
      description: "Hotel client timeouts",
    }),
    circuitBreakerState: meter.createUpDownCounter(
      CIRCUIT_BREAKER_STATE_METRIC,
      {
        description:
          "Circuit breaker state gauge (closed=0, half_open=1, open=2)",
      },
    ),
    circuitBreakerTransitions: meter.createCounter(
      CIRCUIT_BREAKER_TRANSITIONS_METRIC,
      {
        description: "Circuit breaker state transitions",
      },
    ),
    chaosFaultEvents: meter.createCounter(CHAOS_FAULT_EVENTS_METRIC, {
      description: "Chaos fault lifecycle events",
    }),
  };

  return cached;
}

/** Solo para tests: limpia el cache del singleton. */
export function resetChaosMetricsForTests(): void {
  cached = undefined;
}

export function recordFlujoResult(
  outcome: FlujoOutcome,
  durationMs: number,
  attrs: Record<string, string> = {},
): void {
  const m = getChaosMetrics();
  const attributes = { outcome, ...attrs };

  m.flujoRequests.add(1, attributes);

  if (outcome === "success") {
    m.flujoSuccess.add(1, attributes);
  } else {
    m.flujoErrors.add(1, attributes);
  }

  if (outcome === "timeout") {
    m.hotelTimeouts.add(1, attributes);
  }

  m.flujoDuration.record(durationMs / 1000, attributes);
}

export function recordChaosFaultEvent(
  phase: ChaosFaultPhase,
  attrs: Record<string, string> = {},
): void {
  getChaosMetrics().chaosFaultEvents.add(1, { phase, ...attrs });
}

export function recordCircuitBreakerTransition(
  from: string,
  to: string,
): void {
  const m = getChaosMetrics();
  m.circuitBreakerTransitions.add(1, { from, to });

  const stateValue = to === "open" ? 2 : to === "half_open" ? 1 : 0;
  // Delta hacia el nuevo estado (simplificado: set vía add relativo documentado).
  m.circuitBreakerState.add(stateValue, { state: to });
}
