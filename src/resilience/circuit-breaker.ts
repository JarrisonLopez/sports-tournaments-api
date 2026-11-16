import { recordCircuitBreakerTransition } from "../observability/chaos-metrics";

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitOpenError extends Error {
  constructor(message = "Circuit breaker is open for Hotel") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export type CircuitBreakerOptions = {
  failureThreshold: number;
  successThreshold: number;
  openMs: number;
  name?: string;
  now?: () => number;
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openMs: number;
  private readonly name: string;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.successThreshold = options.successThreshold;
    this.openMs = options.openMs;
    this.name = options.name ?? "hotel";
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();

    if (this.state === "open") {
      throw new CircuitOpenError(`Circuit breaker open (${this.name})`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  reset(): void {
    this.transition("closed");
    this.failures = 0;
    this.successes = 0;
    this.openedAt = 0;
  }

  private onSuccess(): void {
    if (this.state === "half_open") {
      this.successes += 1;
      if (this.successes >= this.successThreshold) {
        this.transition("closed");
        this.failures = 0;
        this.successes = 0;
      }
      return;
    }

    this.failures = 0;
  }

  private onFailure(): void {
    this.failures += 1;
    this.successes = 0;

    if (
      this.state === "half_open" ||
      this.failures >= this.failureThreshold
    ) {
      this.openedAt = this.now();
      this.transition("open");
    }
  }

  private maybeHalfOpen(): void {
    if (this.state !== "open") {
      return;
    }

    if (this.now() - this.openedAt >= this.openMs) {
      this.transition("half_open");
      this.successes = 0;
    }
  }

  private transition(to: CircuitState): void {
    if (this.state === to) {
      return;
    }
    const from = this.state;
    this.state = to;
    recordCircuitBreakerTransition(from, to);
  }
}

let hotelBreaker: CircuitBreaker | undefined;

export function getHotelCircuitBreaker(
  options?: CircuitBreakerOptions,
): CircuitBreaker {
  if (!hotelBreaker) {
    hotelBreaker = new CircuitBreaker(
      options ?? {
        failureThreshold: 3,
        successThreshold: 1,
        openMs: 10_000,
        name: "hotel",
      },
    );
  }
  return hotelBreaker;
}

export function resetHotelCircuitBreakerForTests(): void {
  hotelBreaker?.reset();
  hotelBreaker = undefined;
}
