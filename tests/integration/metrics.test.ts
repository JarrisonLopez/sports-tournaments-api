import { describe, expect, it } from "vitest";
import {
  MetricReader,
  type Attributes,
  type Histogram,
} from "@opentelemetry/sdk-metrics";

import { buildApp } from "../../src/app";

class CollectingMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

type MetricPoint = {
  name: string;
  unit: string;
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
        expect(dataPoint.attributes).not.toHaveProperty("traceId");
        expect(Object.keys(dataPoint.attributes).sort()).toEqual(
          [
            "http.method",
            "http.route",
            "http.status_code",
            "service",
          ].sort(),
        );
        points.push({
          name: metric.descriptor.name,
          unit: metric.descriptor.unit,
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

describe("Métricas RED de Sports API", () => {
  it("registra request y duración sin error en una respuesta 2xx", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    app.get("/api/v2/observability-ok", async () => ({ ok: true }));

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/observability-ok",
    });

    expect(respuesta.statusCode).toBe(200);

    const points = await collectPoints(reader);
    const duration = durationPoints(points);

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(0);
    expect(duration).toHaveLength(1);
    expect(duration[0].unit).toBe("s");
    expect((duration[0].value as Histogram).count).toBe(1);
    expect((duration[0].value as Histogram).sum).toBeGreaterThanOrEqual(0);
    expect(points.find((point) => point.name === "http.server.requests")?.attributes)
      .toMatchObject({
        service: "sports-api",
        "http.method": "GET",
        "http.route": "/api/v2/observability-ok",
        "http.status_code": 200,
      });

    await app.close();
  });

  it("cuenta una respuesta 5xx como request y como error", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    app.get("/api/v2/observability-error", async (_request, reply) => {
      return reply.code(500).send({ message: "error" });
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/observability-error",
    });

    expect(respuesta.statusCode).toBe(500);

    const points = await collectPoints(reader);
    const duration = durationPoints(points);

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(1);
    expect(duration).toHaveLength(1);
    expect((duration[0].value as Histogram).count).toBe(1);
    expect(
      points.find((point) => point.name === "http.server.errors")?.attributes,
    ).toMatchObject({
      service: "sports-api",
      "http.method": "GET",
      "http.route": "/api/v2/observability-error",
      "http.status_code": 500,
    });

    await app.close();
  });

  it("cuenta una respuesta 4xx como request y no como error", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/flujo/abc/1/2?detalle=1",
    });

    expect(respuesta.statusCode).toBe(400);

    const points = await collectPoints(reader);
    const requests = points.filter(
      (point) => point.name === "http.server.requests",
    );

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(0);
    expect(requests[0].attributes["http.route"]).toBe(
      "/api/v2/flujo/:torneoId/:habitacionId/:peliculaId",
    );
    expect((durationPoints(points)[0].value as Histogram).count).toBe(1);

    await app.close();
  });

  it("no registra healthchecks ni rutas fuera de /api/v2", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const live = await app.inject({
      method: "GET",
      url: "/health/live",
    });
    const ready = await app.inject({
      method: "GET",
      url: "/health/ready",
    });
    const root = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(root.statusCode).toBe(200);
    expect(await collectPoints(reader)).toEqual([]);

    await app.close();
  });

  it("usa la misma plantilla para ids distintos y unmatched sin ids", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const primera = await app.inject({
      method: "GET",
      url: "/api/v2/flujo/1/2/x",
    });
    const segunda = await app.inject({
      method: "GET",
      url: "/api/v2/flujo/9/8/y",
    });
    const desconocida = await app.inject({
      method: "GET",
      url: "/api/v2/no-existe/123",
    });

    expect(primera.statusCode).toBe(400);
    expect(segunda.statusCode).toBe(400);
    expect(desconocida.statusCode).toBe(404);

    const points = await collectPoints(reader);
    const requests = points.filter(
      (point) => point.name === "http.server.requests",
    );
    const flujo = requests.find(
      (point) =>
        point.attributes["http.route"] ===
        "/api/v2/flujo/:torneoId/:habitacionId/:peliculaId",
    );
    const unmatched = requests.find(
      (point) => point.attributes["http.route"] === "unmatched",
    );

    expect(flujo?.value).toBe(2);
    expect(unmatched?.value).toBe(1);
    expect(JSON.stringify(requests)).not.toContain("/api/v2/flujo/1/2/x");
    expect(JSON.stringify(requests)).not.toContain("/api/v2/flujo/9/8/y");
    expect(JSON.stringify(requests)).not.toContain("123");

    await app.close();
  });
});
