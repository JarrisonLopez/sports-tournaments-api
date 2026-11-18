import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MetricReader,
  type Attributes,
  type Histogram,
} from "@opentelemetry/sdk-metrics";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
  crear: vi.fn(),
  listar: vi.fn(),
  actualizar: vi.fn(),
  eliminar: vi.fn(),
}));

import { buildApp } from "../../src/app";
import {
  API_TRACK_ATTR,
  API_VERSION_ATTR,
  TORNEO_LOOKUP_SUCCESS_METRIC,
  TORNEO_LOOKUP_SUCCESS_ROUTE,
  TORNEO_RESUMEN_REQUESTS_METRIC,
} from "../../src/observability/metrics";
import {
  API_TRACK_HEADER,
  API_VERSION_HEADER,
} from "../../src/config/runtime-identity";
import { buscarPorId } from "../../src/services/torneo.service";

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

const RED_ATTRIBUTE_KEYS = [
  "api.track",
  "api.version",
  "http.method",
  "http.route",
  "http.status_code",
  "service",
].sort();

const LOOKUP_ATTRIBUTE_KEYS = ["api.track", "api.version", "http.route"].sort();

const RESUMEN_ATTRIBUTE_KEYS = [
  "api.track",
  "api.version",
  "http.route",
  "outcome",
].sort();

async function collectPoints(
  reader: CollectingMetricReader,
): Promise<MetricPoint[]> {
  const result = await reader.collect();
  const points: MetricPoint[] = [];

  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const dataPoint of metric.dataPoints) {
        expect(dataPoint.attributes).not.toHaveProperty("traceId");

        if (metric.descriptor.name === TORNEO_LOOKUP_SUCCESS_METRIC) {
          expect(Object.keys(dataPoint.attributes).sort()).toEqual(
            LOOKUP_ATTRIBUTE_KEYS,
          );
        } else if (metric.descriptor.name === TORNEO_RESUMEN_REQUESTS_METRIC) {
          expect(Object.keys(dataPoint.attributes).sort()).toEqual(
            RESUMEN_ATTRIBUTE_KEYS,
          );
        } else {
          expect(Object.keys(dataPoint.attributes).sort()).toEqual(
            RED_ATTRIBUTE_KEYS,
          );
        }

        const serialized = JSON.stringify(dataPoint.attributes);
        expect(serialized).not.toMatch(/\/api\/v2\/torneos\/\d+/);
        expect(serialized).not.toMatch(/\/api\/v4\/torneos\/\d+/);

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

const torneo = {
  id: 1,
  nombre: "Torneo Universitario",
  deporte: "Futbol",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-09-15",
  estado: "PROGRAMADO",
};

describe("Métricas RED de Sports API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registra request y duración sin error en una respuesta 2xx", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "3.0.1", track: "stable" },
    });

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
    expect(
      points.find((point) => point.name === "http.server.requests")?.attributes,
    ).toMatchObject({
      service: "sports-api",
      "http.method": "GET",
      "http.route": "/api/v2/observability-ok",
      "http.status_code": 200,
      [API_VERSION_ATTR]: "3.0.1",
      [API_TRACK_ATTR]: "stable",
    });

    await app.close();
  });

  it("cuenta una respuesta 5xx como request y como error", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "3.0.1", track: "stable" },
    });

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
      [API_VERSION_ATTR]: "3.0.1",
      [API_TRACK_ATTR]: "stable",
    });

    await app.close();
  });

  it("cuenta una respuesta 4xx como request y no como error", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "3.0.1", track: "stable" },
    });

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

  it("no registra healthchecks ni rutas fuera de /api/v2, /api/v3 y /api/v4", async () => {
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

  it("propaga api.version y api.track canary en instrumentos RED", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "4.0.0", track: "canary" },
    });

    app.get("/api/v2/observability-ok", async () => ({ ok: true }));

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/observability-ok",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");

    const points = await collectPoints(reader);
    expect(
      points.find((point) => point.name === "http.server.requests")?.attributes,
    ).toMatchObject({
      [API_VERSION_ATTR]: "4.0.0",
      [API_TRACK_ATTR]: "canary",
    });

    await app.close();
  });
});

describe("Métrica de negocio sports.torneo.lookup.success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("incrementa una vez en GET /api/v2/torneos/:id con 200 (stable)", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "3.0.1", track: "stable" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual(torneo);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("3.0.1");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("stable");

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(1);
    expect(
      points.find((point) => point.name === TORNEO_LOOKUP_SUCCESS_METRIC)
        ?.attributes,
    ).toEqual({
      [API_VERSION_ATTR]: "3.0.1",
      [API_TRACK_ATTR]: "stable",
      "http.route": TORNEO_LOOKUP_SUCCESS_ROUTE,
    });

    await app.close();
  });

  it("incrementa una vez con identidad canary", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "4.0.0", track: "canary" },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/42",
    });

    expect(respuesta.statusCode).toBe(200);

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(1);
    expect(
      points.find((point) => point.name === TORNEO_LOOKUP_SUCCESS_METRIC)
        ?.attributes,
    ).toMatchObject({
      [API_VERSION_ATTR]: "4.0.0",
      [API_TRACK_ATTR]: "canary",
      "http.route": TORNEO_LOOKUP_SUCCESS_ROUTE,
    });
    expect(JSON.stringify(points)).not.toContain("42");

    await app.close();
  });

  it("no incrementa en 404 ni en 500", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "3.0.1", track: "stable" },
    });

    vi.mocked(buscarPorId).mockResolvedValueOnce(null);
    const notFound = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/999",
    });
    expect(notFound.statusCode).toBe(404);

    vi.mocked(buscarPorId).mockRejectedValueOnce(new Error("db down"));
    const serverError = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
    });
    expect(serverError.statusCode).toBe(500);

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(0);
    expect(counterTotal(points, "http.server.requests")).toBe(2);
    expect(counterTotal(points, "http.server.errors")).toBe(1);

    await app.close();
  });

  it("no incrementa para otros métodos o rutas", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      metricsReader: reader,
      identity: { version: "3.0.1", track: "stable" },
    });

    const listado = await app.inject({
      method: "GET",
      url: "/api/v2/torneos",
    });
    const rootTorneo = await app.inject({
      method: "GET",
      url: "/torneos/1",
    });

    expect(listado.statusCode).toBe(200);
    expect(rootTorneo.statusCode).toBe(200);

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(0);

    await app.close();
  });
});
