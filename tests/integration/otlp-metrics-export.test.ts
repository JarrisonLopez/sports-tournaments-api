import { createServer, type Server } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MetricReader,
  PeriodicExportingMetricReader,
  type Attributes,
  type Histogram,
} from "@opentelemetry/sdk-metrics";

import { buildApp } from "../../src/app";
import {
  METRIC_EXPORT_INTERVAL_MILLIS,
  resolveMetricReaders,
} from "../../src/observability/metrics";

const DEFAULT_OTLP_PORT = 4318;
const ALLOWED_ATTRIBUTES = [
  "http.method",
  "http.route",
  "http.status_code",
  "service",
];

class CollectingMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

type CapturedRequest = {
  path: string;
  body: string;
  contentType: string | undefined;
};

type OtlpKeyValue = {
  key?: string;
  value?: {
    stringValue?: string;
    intValue?: number | string;
    doubleValue?: number;
  };
};

type OtlpDataPoint = {
  attributes?: OtlpKeyValue[];
  asInt?: number | string;
  asDouble?: number;
};

type OtlpHistogramPoint = {
  attributes?: OtlpKeyValue[];
  explicitBounds?: number[];
  count?: number | string;
};

type OtlpMetric = {
  name?: string;
  unit?: string;
  sum?: { dataPoints?: OtlpDataPoint[] };
  histogram?: { dataPoints?: OtlpHistogramPoint[] };
};

type OtlpPayload = {
  resourceMetrics?: Array<{
    resource?: { attributes?: OtlpKeyValue[] };
    scopeMetrics?: Array<{
      scope?: { name?: string };
      metrics?: OtlpMetric[];
    }>;
  }>;
};

const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const originalMetricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;

describe("Exportación OTLP de métricas RED en Sports", () => {
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  });

  afterEach(() => {
    restoreEnv("OTEL_EXPORTER_OTLP_ENDPOINT", originalEndpoint);
    restoreEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", originalMetricsEndpoint);
  });

  it("sin endpoint no crea exporter y el reader inyectado sigue viendo RED", async () => {
    expect(resolveMetricReaders()).toEqual([]);
    expect(METRIC_EXPORT_INTERVAL_MILLIS).toBe(60_000);

    const metricsOnly = resolveMetricReaders(undefined, {
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://127.0.0.1:9",
    });

    expect(metricsOnly).toEqual([]);

    const connects = captureConnects();
    const reader = new CollectingMetricReader();
    const app = buildApp({ logger: false, metricsReader: reader });

    app.get("/api/v2/otlp-metrics-local", async () => ({ ok: true }));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v2/otlp-metrics-local",
      });

      expect(response.statusCode).toBe(200);

      const points = await collectPoints(reader);

      expect(counterTotal(points, "http.server.requests")).toBe(1);
      expect(counterTotal(points, "http.server.errors")).toBe(0);
      expect(durationPoints(points)).toHaveLength(1);
      expect(
        connects.attempts.filter((attempt) =>
          attempt.endsWith(`:${DEFAULT_OTLP_PORT}`),
        ),
      ).toEqual([]);
    } finally {
      connects.restore();
      await closeApp(app);
    }
  });

  it("trata el endpoint vacío o inválido como ausente", () => {
    for (const endpoint of ["", "   ", "no-es-una-url", "ftp://127.0.0.1/otlp"]) {
      expect(
        resolveMetricReaders(undefined, {
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        }),
      ).toEqual([]);
    }
  });

  it("normaliza el endpoint con y sin barra final hacia /v1/metrics", async () => {
    for (const suffix of ["", "/"]) {
      const receiver = await listen();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${receiver.origin}${suffix}`;
      const app = buildApp({ logger: false });

      app.get("/api/v2/otlp-metrics-path", async () => ({ ok: true }));

      try {
        const response = await app.inject({
          method: "GET",
          url: "/api/v2/otlp-metrics-path",
        });

        expect(response.statusCode).toBe(200);
        await app.close();

        expect(receiver.requests).toHaveLength(1);
        expect(receiver.requests[0]?.path).toBe("/v1/metrics");
        expect(receiver.requests[0]?.path.includes("//")).toBe(false);
      } finally {
        await closeApp(app);
        await receiver.close();
      }
    }
  });

  it("un reader explícito no agrega el exporter aunque haya endpoint", async () => {
    const receiver = await listen();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.origin;
    const reader = new CollectingMetricReader();

    expect(resolveMetricReaders(reader)).toEqual([reader]);
    expect(resolveMetricReaders(reader)[0]).not.toBeInstanceOf(
      PeriodicExportingMetricReader,
    );

    const app = buildApp({ logger: false, metricsReader: reader });

    app.get("/api/v2/otlp-metrics-explicit", async () => ({ ok: true }));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v2/otlp-metrics-explicit",
      });

      expect(response.statusCode).toBe(200);

      const points = await collectPoints(reader);

      await app.close();

      expect(counterTotal(points, "http.server.requests")).toBe(1);
      expect(receiver.requests).toEqual([]);
    } finally {
      await closeApp(app);
      await receiver.close();
    }
  });

  it("exporta las métricas RED al cerrar Fastify sin esperar 60s", async () => {
    const receiver = await listen();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.origin;

    const readers = resolveMetricReaders();
    expect(readers).toHaveLength(1);
    expect(readers[0]).toBeInstanceOf(PeriodicExportingMetricReader);

    const app = buildApp({ logger: false });

    app.get("/api/v2/otlp-metrics-ok", async () => ({ ok: true }));
    app.get("/api/v2/otlp-metrics-error", async (_request, reply) => {
      return reply.code(500).send({ ok: false });
    });

    const startedAt = Date.now();

    try {
      const ok = await app.inject({
        method: "GET",
        url: "/api/v2/otlp-metrics-ok",
      });
      const failure = await app.inject({
        method: "GET",
        url: "/api/v2/otlp-metrics-error",
      });

      expect(ok.statusCode).toBe(200);
      expect(failure.statusCode).toBe(500);

      await app.close();

      expect(Date.now() - startedAt).toBeLessThan(METRIC_EXPORT_INTERVAL_MILLIS);
      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0]?.path).toBe("/v1/metrics");
      expect(receiver.requests[0]?.contentType).toContain("application/json");

      const payload = JSON.parse(receiver.requests[0]?.body ?? "") as OtlpPayload;
      const resource = payload.resourceMetrics?.[0];
      const scope = resource?.scopeMetrics?.[0];

      expect(resourceAttribute(resource?.resource?.attributes, "service.name")).toBe(
        "sports-api",
      );
      expect(scope?.scope?.name).toBe("sports-api");

      const metrics = scope?.metrics ?? [];
      const requests = metricNamed(metrics, "http.server.requests");
      const errors = metricNamed(metrics, "http.server.errors");
      const duration = metricNamed(metrics, "http.server.request.duration");

      expect(pointAttributes(requests.sum?.dataPoints ?? [])).toEqual([
        {
          service: "sports-api",
          "http.method": "GET",
          "http.route": "/api/v2/otlp-metrics-ok",
          "http.status_code": 200,
        },
        {
          service: "sports-api",
          "http.method": "GET",
          "http.route": "/api/v2/otlp-metrics-error",
          "http.status_code": 500,
        },
      ]);
      expect(errors.sum?.dataPoints).toHaveLength(1);
      expect(pointAttributes(errors.sum?.dataPoints ?? [])).toEqual([
        {
          service: "sports-api",
          "http.method": "GET",
          "http.route": "/api/v2/otlp-metrics-error",
          "http.status_code": 500,
        },
      ]);
      expect(duration.unit).toBe("s");
      expect(duration.histogram?.dataPoints?.[0]?.explicitBounds).toEqual([
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ]);
      expect(pointAttributes(duration.histogram?.dataPoints ?? [])).toEqual(
        pointAttributes(requests.sum?.dataPoints ?? []),
      );
    } finally {
      await closeApp(app);
      await receiver.close();
    }
  }, 20_000);
});

function metricNamed(metrics: OtlpMetric[], name: string): OtlpMetric {
  const matches = metrics.filter((metric) => metric.name === name);

  expect(matches).toHaveLength(1);

  const match = matches[0];

  if (!match) {
    throw new Error(`Falta la métrica ${name}`);
  }

  return match;
}

function pointAttributes(
  points: Array<{ attributes?: OtlpKeyValue[] }>,
): Array<Record<string, string | number>> {
  return points
    .map((point) => {
      const attributes = attributeMap(point.attributes);

      expect(Object.keys(attributes).sort()).toEqual([...ALLOWED_ATTRIBUTES].sort());
      expect(attributes).not.toHaveProperty("traceId");

      return attributes;
    })
    .sort((left, right) =>
      String(left["http.status_code"]).localeCompare(String(right["http.status_code"])),
    );
}

function attributeMap(
  attributes: OtlpKeyValue[] | undefined,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};

  for (const attribute of attributes ?? []) {
    if (!attribute.key || !attribute.value) {
      continue;
    }

    const { stringValue, intValue, doubleValue } = attribute.value;

    if (stringValue !== undefined) {
      result[attribute.key] = stringValue;
    } else if (intValue !== undefined) {
      result[attribute.key] = Number(intValue);
    } else if (doubleValue !== undefined) {
      result[attribute.key] = doubleValue;
    }
  }

  return result;
}

function resourceAttribute(
  attributes: OtlpKeyValue[] | undefined,
  key: string,
): string | number | undefined {
  return attributeMap(attributes)[key];
}

type MetricPoint = {
  name: string;
  attributes: Attributes;
  value: number | Histogram;
};

async function collectPoints(
  reader: CollectingMetricReader,
): Promise<MetricPoint[]> {
  const result = await reader.collect();
  const points: MetricPoint[] = [];

  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const dataPoint of metric.dataPoints) {
        points.push({
          name: metric.descriptor.name,
          attributes: dataPoint.attributes,
          value: dataPoint.value,
        });
      }
    }
  }

  return points;
}

function counterTotal(points: MetricPoint[], name: string): number {
  return points
    .filter((point) => point.name === name && typeof point.value === "number")
    .reduce((total, point) => total + (point.value as number), 0);
}

function durationPoints(points: MetricPoint[]): MetricPoint[] {
  return points.filter(
    (point) =>
      point.name === "http.server.request.duration" &&
      typeof point.value === "object",
  );
}

async function closeApp(app: { close: () => Promise<unknown> }): Promise<void> {
  try {
    await app.close();
  } catch {
    // El caso de éxito ya cerró Fastify antes de salir del try.
  }
}

async function listen(): Promise<{
  origin: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: headerValue(request.headers["content-type"]),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El receptor OTLP no expuso un puerto TCP");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function captureConnects(): { attempts: string[]; restore: () => void } {
  const attempts: string[] = [];
  const original = Socket.prototype.connect;

  Socket.prototype.connect = function connect(
    this: Socket,
    ...args: Parameters<Socket["connect"]>
  ): Socket {
    attempts.push(connectTarget(args[0]));
    return original.apply(this, args);
  } as Socket["connect"];

  return {
    attempts,
    restore() {
      Socket.prototype.connect = original;
    },
  };
}

function connectTarget(target: Parameters<Socket["connect"]>[0]): string {
  if (typeof target === "object" && target !== null && "port" in target) {
    const host =
      "host" in target
        ? target.host
        : "hostname" in target
          ? target.hostname
          : "";

    return `${String(host ?? "")}:${String(target.port)}`;
  }

  return String(target);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
