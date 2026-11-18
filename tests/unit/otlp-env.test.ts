import { describe, expect, it } from "vitest";

import {
  DEFAULT_OTEL_SERVICE_NAME,
  isOtlpSignalEnabled,
  otlpSignalUrl,
  resolveOtelServiceName,
  resolveOtlpHttpProtocol,
} from "../../src/observability/otlp-env";

describe("otlp-env", () => {
  it("resuelve service name con default", () => {
    expect(resolveOtelServiceName({})).toBe(DEFAULT_OTEL_SERVICE_NAME);
    expect(resolveOtelServiceName({ OTEL_SERVICE_NAME: "  sports-api  " })).toBe(
      "sports-api",
    );
  });

  it("habilita otlp salvo none", () => {
    expect(isOtlpSignalEnabled(undefined, true)).toBe(true);
    expect(isOtlpSignalEnabled("otlp", true)).toBe(true);
    expect(isOtlpSignalEnabled("none", true)).toBe(false);
  });

  it("elige protocolo http/protobuf o json", () => {
    expect(resolveOtlpHttpProtocol({})).toBe("http/json");
    expect(
      resolveOtlpHttpProtocol({ OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf" }),
    ).toBe("http/protobuf");
  });

  it("construye URL de señal sin duplicar path si el caller pasa base", () => {
    expect(otlpSignalUrl("https://hotel-otel-lab:31443", "v1/traces")).toBe(
      "https://hotel-otel-lab:31443/v1/traces",
    );
    expect(otlpSignalUrl("", "v1/traces")).toBeUndefined();
  });
});
