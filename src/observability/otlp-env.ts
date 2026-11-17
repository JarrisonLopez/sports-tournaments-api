/**
 * Lectura compartida de variables OTEL usadas por traces y métricas.
 * El exporter Node (@opentelemetry/exporter-*-otlp-*) ya fusiona
 * OTEL_EXPORTER_OTLP_HEADERS y OTEL_EXPORTER_OTLP_CERTIFICATE desde el entorno
 * al construir OTLP*Exporter({ url }).
 */

export const DEFAULT_OTEL_SERVICE_NAME = "sports-api";

export const OTLP_TRACES_PATH = "v1/traces";
export const OTLP_METRICS_PATH = "v1/metrics";

export type OtlpHttpProtocol = "http/json" | "http/protobuf";

export function resolveOtelServiceName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.OTEL_SERVICE_NAME?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_OTEL_SERVICE_NAME;
}

export function isOtlpSignalEnabled(
  envVar: string | undefined,
  defaultEnabledWhenEndpoint: boolean,
): boolean {
  const raw = envVar?.trim().toLowerCase();

  if (!raw || raw.length === 0) {
    return defaultEnabledWhenEndpoint;
  }

  if (raw === "none") {
    return false;
  }

  return raw === "otlp" || raw === "otlphttp" || raw === "otlp_http";
}

export function resolveOtlpHttpProtocol(
  env: NodeJS.ProcessEnv = process.env,
): OtlpHttpProtocol {
  const raw = env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim().toLowerCase();

  if (raw === "http/protobuf" || raw === "http/proto") {
    return "http/protobuf";
  }

  // Default del lab Sports: JSON (compatible con tests y collectors OTLP/HTTP).
  return "http/json";
}

export function otlpSignalUrl(
  endpoint: string | undefined,
  resourcePath: string,
): string | undefined {
  if (typeof endpoint !== "string") {
    return undefined;
  }

  const base = endpoint.trim();

  if (base.length === 0) {
    return undefined;
  }

  const withSlash = base.endsWith("/") ? base : `${base}/`;

  try {
    const url = new URL(`${withSlash}${resourcePath}`);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}
