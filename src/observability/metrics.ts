import { Counter, Histogram } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  MeterProvider,
  MetricReader,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { FastifyInstance, FastifyRequest } from "fastify";

import {
  resolveRuntimeIdentity,
  type RuntimeIdentity,
} from "../config/runtime-identity";

export const HTTP_REQUESTS_METRIC = "http.server.requests";
export const HTTP_ERRORS_METRIC = "http.server.errors";
export const HTTP_DURATION_METRIC = "http.server.request.duration";
export const TORNEO_LOOKUP_SUCCESS_METRIC = "sports.torneo.lookup.success";
export const TORNEO_RESUMEN_REQUESTS_METRIC = "sports.torneo.resumen.requests";

export const API_VERSION_ATTR = "api.version";
export const API_TRACK_ATTR = "api.track";
export const OUTCOME_ATTR = "outcome";

/** Plantilla Fastify (con prefijo) de la consulta compartida v2. */
export const TORNEO_LOOKUP_SUCCESS_ROUTE = "/api/v2/torneos/:id";

/** Plantilla Fastify (con prefijo) del resumen exclusivo v4. */
export const TORNEO_RESUMEN_ROUTE = "/api/v4/torneos/:id/resumen";

export type ResumenOutcome = "success" | "client_error" | "server_error";

/**
 * Unit of http.server.request.duration.
 * Seconds, matching the OpenTelemetry HTTP semantic convention.
 * Fastify's reply.elapsedTime is milliseconds and is converted on record.
 */
export const HTTP_DURATION_UNIT = "s";

const UNMATCHED_ROUTE = "unmatched";

const HEALTH_PATHS = new Set(["/health/live", "/health/ready"]);

const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const OTLP_METRICS_PATH = "v1/metrics";

export const METRIC_EXPORT_INTERVAL_MILLIS = 60_000;

export type HttpMetrics = {
  serviceName: string;
  identity: RuntimeIdentity;
  requests: Counter;
  errors: Counter;
  duration: Histogram;
  torneoLookupSuccess: Counter;
  torneoResumenRequests: Counter;
  shutdown: () => Promise<void>;
};

/**
 * Creates the RED instruments for one process.
 * An explicit MetricReader is used alone. Without one, a valid
 * OTEL_EXPORTER_OTLP_ENDPOINT adds a PeriodicExportingMetricReader.
 */
export function createHttpMetrics(
  serviceName: string,
  reader?: MetricReader,
  env: NodeJS.ProcessEnv = process.env,
  identity: RuntimeIdentity = resolveRuntimeIdentity(env),
): HttpMetrics {
  const provider = new MeterProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
    ),
    readers: resolveMetricReaders(reader, env),
    sdkMetricsEnabled: false,
  });

  const meter = provider.getMeter(serviceName);

  const requests = meter.createCounter(HTTP_REQUESTS_METRIC, {
    description: "HTTP requests received on /api/v2, /api/v3 and /api/v4",
  });

  const errors = meter.createCounter(HTTP_ERRORS_METRIC, {
    description: "HTTP responses with status code >= 500",
  });

  const duration = meter.createHistogram(HTTP_DURATION_METRIC, {
    description: "End-to-end HTTP server request duration",
    unit: HTTP_DURATION_UNIT,
    advice: {
      explicitBucketBoundaries: DURATION_BUCKETS_SECONDS,
    },
  });

  const torneoLookupSuccess = meter.createCounter(
    TORNEO_LOOKUP_SUCCESS_METRIC,
    {
      description:
        "Successful GET /api/v2/torneos/:id responses (shared stable/canary business metric)",
    },
  );

  const torneoResumenRequests = meter.createCounter(
    TORNEO_RESUMEN_REQUESTS_METRIC,
    {
      description:
        "GET /api/v4/torneos/:id/resumen responses classified by outcome (canary v4)",
    },
  );

  return {
    serviceName,
    identity,
    requests,
    errors,
    duration,
    torneoLookupSuccess,
    torneoResumenRequests,
    shutdown: () => provider.shutdown(),
  };
}

export function resolveMetricReaders(
  reader?: MetricReader,
  env: NodeJS.ProcessEnv = process.env,
): MetricReader[] {
  if (reader) {
    return [reader];
  }

  const url = otlpMetricsUrl(env.OTEL_EXPORTER_OTLP_ENDPOINT);

  if (!url) {
    return [];
  }

  return [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url }),
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MILLIS,
    }),
  ];
}

function otlpMetricsUrl(endpoint: string | undefined): string | undefined {
  if (typeof endpoint !== "string") {
    return undefined;
  }

  const base = endpoint.trim();

  if (base.length === 0) {
    return undefined;
  }

  const withSlash = base.endsWith("/") ? base : `${base}/`;

  try {
    const url = new URL(`${withSlash}${OTLP_METRICS_PATH}`);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

export function registerRedMetrics(
  app: FastifyInstance,
  httpMetrics: HttpMetrics,
): void {
  app.addHook("onResponse", async (request, reply) => {
    const pathname = pathnameOf(request.url);

    if (isHealthPath(pathname) || !isMeasuredApiPath(pathname)) {
      return;
    }

    const route = resolveHttpRoute(request);

    const attributes = {
      service: httpMetrics.serviceName,
      "http.method": request.method,
      "http.route": route,
      "http.status_code": reply.statusCode,
      [API_VERSION_ATTR]: httpMetrics.identity.version,
      [API_TRACK_ATTR]: httpMetrics.identity.track,
    };

    httpMetrics.requests.add(1, attributes);

    if (reply.statusCode >= 500) {
      httpMetrics.errors.add(1, attributes);
    }

    httpMetrics.duration.record(reply.elapsedTime / 1000, attributes);

    if (isTorneoLookupSuccess(request.method, route, reply.statusCode)) {
      httpMetrics.torneoLookupSuccess.add(1, {
        [API_VERSION_ATTR]: httpMetrics.identity.version,
        [API_TRACK_ATTR]: httpMetrics.identity.track,
        "http.route": route,
      });
    }

    if (isTorneoResumenRequest(request.method, route)) {
      httpMetrics.torneoResumenRequests.add(1, {
        [API_VERSION_ATTR]: httpMetrics.identity.version,
        [API_TRACK_ATTR]: httpMetrics.identity.track,
        "http.route": route,
        [OUTCOME_ATTR]: classifyResumenOutcome(reply.statusCode),
      });
    }
  });

  app.addHook("onClose", async () => {
    await httpMetrics.shutdown();
  });
}

function isTorneoLookupSuccess(
  method: string,
  route: string,
  statusCode: number,
): boolean {
  return (
    method === "GET" &&
    route === TORNEO_LOOKUP_SUCCESS_ROUTE &&
    statusCode === 200
  );
}

function isTorneoResumenRequest(method: string, route: string): boolean {
  return method === "GET" && route === TORNEO_RESUMEN_ROUTE;
}

export function classifyResumenOutcome(statusCode: number): ResumenOutcome {
  if (statusCode >= 200 && statusCode < 300) {
    return "success";
  }

  if (statusCode >= 400 && statusCode < 500) {
    return "client_error";
  }

  return "server_error";
}

function pathnameOf(url: string): string {
  const queryIndex = url.indexOf("?");

  if (queryIndex === -1) {
    return url;
  }

  return url.slice(0, queryIndex);
}

function isHealthPath(pathname: string): boolean {
  return HEALTH_PATHS.has(pathname);
}

function isMeasuredApiPath(pathname: string): boolean {
  return (
    pathname === "/api/v2" ||
    pathname.startsWith("/api/v2/") ||
    pathname === "/api/v3" ||
    pathname.startsWith("/api/v3/") ||
    pathname === "/api/v4" ||
    pathname.startsWith("/api/v4/")
  );
}

export function resolveHttpRoute(request: FastifyRequest): string {
  const routeUrl = request.routeOptions.url;

  if (request.is404 || typeof routeUrl !== "string" || routeUrl.length === 0) {
    return UNMATCHED_ROUTE;
  }

  return routeUrl;
}
