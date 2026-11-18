import { describe, expect, it } from "vitest";

import { resolveFlujoOrchestrationMode } from "../../src/config/flujo-orchestration";

describe("resolveFlujoOrchestrationMode", () => {
  it("usa sequential por defecto", () => {
    expect(resolveFlujoOrchestrationMode({})).toBe("sequential");
  });

  it("acepta parallel explícito", () => {
    expect(
      resolveFlujoOrchestrationMode({ FLUJO_ORCHESTRATION_MODE: "parallel" }),
    ).toBe("parallel");
  });

  it("ignora valores desconocidos y cae a sequential", () => {
    expect(
      resolveFlujoOrchestrationMode({ FLUJO_ORCHESTRATION_MODE: "weird" }),
    ).toBe("sequential");
  });
});
