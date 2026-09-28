import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MetricReader,
  type Attributes,
  type Histogram,
} from "@opentelemetry/sdk-metrics";

const mocks = vi.hoisted(() => {
  const save = vi.fn();
  const download = vi.fn();
  const file = vi.fn(() => ({ save, download }));
  const bucket = vi.fn(() => ({ file }));

  return { save, download, file, bucket };
});

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class {
      bucket(bucketName: string) {
        return mocks.bucket(bucketName);
      }
    },
  };
});

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

const artifact = {
  traceId: "trace-1",
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
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

describe("Métricas RED de Object Storage", () => {
  beforeEach(() => {
    mocks.save.mockReset();
    mocks.download.mockReset();
    mocks.file.mockReset();
    mocks.bucket.mockReset();
    mocks.file.mockImplementation(() => ({
      save: mocks.save,
      download: mocks.download,
    }));
    mocks.bucket.mockImplementation(() => ({
      file: mocks.file,
    }));
    mocks.save.mockResolvedValue(undefined);
    process.env.GCS_BUCKET_NAME = "test-bucket";
  });

  it("registra request y duración sin error en una respuesta 2xx", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(201);

    const points = await collectPoints(reader);
    const duration = durationPoints(points);

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(0);
    expect(duration).toHaveLength(1);
    expect(duration[0].unit).toBe("s");
    expect((duration[0].value as Histogram).count).toBe(1);
    expect((duration[0].value as Histogram).sum).toBeGreaterThanOrEqual(0);
    expect(
      points.find((point) => point.name === "http.server.requests")?.attributes,
    ).toMatchObject({
      service: "object-storage",
      "http.method": "POST",
      "http.route": "/api/v2/artifacts",
      "http.status_code": 201,
    });

    await app.close();
  });

  it("cuenta una respuesta 5xx como request y como error", async () => {
    delete process.env.GCS_BUCKET_NAME;

    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(503);

    const points = await collectPoints(reader);
    const duration = durationPoints(points);

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(1);
    expect(duration).toHaveLength(1);
    expect((duration[0].value as Histogram).count).toBe(1);
    expect(
      points.find((point) => point.name === "http.server.errors")?.attributes,
    ).toMatchObject({
      service: "object-storage",
      "http.method": "POST",
      "http.route": "/api/v2/artifacts",
      "http.status_code": 503,
    });

    await app.close();
  });

  it("cuenta una respuesta 4xx como request y no como error", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts?detalle=1",
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(400);

    const points = await collectPoints(reader);

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(0);
    expect((durationPoints(points)[0].value as Histogram).count).toBe(1);
    expect(
      points.find((point) => point.name === "http.server.requests")?.attributes[
        "http.route"
      ],
    ).toBe("/api/v2/artifacts");

    await app.close();
  });

  it("no registra healthchecks", async () => {
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

    delete process.env.GCS_BUCKET_NAME;

    const notReady = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(notReady.statusCode).toBe(503);
    expect(await collectPoints(reader)).toEqual([]);

    await app.close();
  });

  it("usa la plantilla de artifacts y no el trace id real", async () => {
    mocks.download.mockRejectedValue({ code: 404 });

    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const primera = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-aaa",
      headers: {
        "x-trace-id": "trace-aaa",
      },
    });
    const segunda = await app.inject({
      method: "GET",
      url: "/api/v2/artifacts/trace-bbb",
      headers: {
        "x-trace-id": "trace-bbb",
      },
    });

    expect(primera.statusCode).toBe(404);
    expect(segunda.statusCode).toBe(404);

    const points = await collectPoints(reader);
    const requests = points.filter(
      (point) => point.name === "http.server.requests",
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].value).toBe(2);
    expect(requests[0].attributes["http.route"]).toBe(
      "/api/v2/artifacts/:traceId",
    );
    expect(requests[0].attributes["http.method"]).toBe("GET");
    expect(JSON.stringify(requests)).not.toContain("trace-aaa");
    expect(JSON.stringify(requests)).not.toContain("trace-bbb");
    expect(counterTotal(points, "http.server.errors")).toBe(0);

    await app.close();
  });

  it("usa unmatched cuando la ruta no existe y no copia ids de la URL", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({ metricsReader: reader });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/no-existe/abc",
    });

    expect(respuesta.statusCode).toBe(404);

    const points = await collectPoints(reader);
    const requests = points.filter(
      (point) => point.name === "http.server.requests",
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].attributes["http.route"]).toBe("unmatched");
    expect(JSON.stringify(requests)).not.toContain("abc");

    await app.close();
  });
});