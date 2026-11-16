import { describe, expect, it } from "vitest";

import {
  CircuitBreaker,
  CircuitOpenError,
} from "../../src/resilience/circuit-breaker";

describe("CircuitBreaker", () => {
  it("abre tras N fallos y rechaza llamadas", async () => {
    let now = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      openMs: 100,
      now: () => now,
    });

    await expect(cb.exec(async () => { throw new Error("x"); })).rejects.toThrow();
    await expect(cb.exec(async () => { throw new Error("x"); })).rejects.toThrow();
    expect(cb.getState()).toBe("open");
    await expect(cb.exec(async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("pasa a half_open y cierra tras éxito", async () => {
    let now = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      openMs: 50,
      now: () => now,
    });

    await expect(cb.exec(async () => { throw new Error("x"); })).rejects.toThrow();
    expect(cb.getState()).toBe("open");
    now = 60;
    expect(cb.getState()).toBe("half_open");
    await expect(cb.exec(async () => "ok")).resolves.toBe("ok");
    expect(cb.getState()).toBe("closed");
  });
});
