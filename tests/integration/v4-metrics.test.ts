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
  API_TRACK_HEADER,
  API_VERSION_HEADER,
} from "../../src/config/runtime-identity";
import {
  API_TRACK_ATTR,
  API_VERSION_ATTR,
  OUTCOME_ATTR,
  TORNEO_LOOKUP_SUCCESS_METRIC,
  TORNEO_LOOKUP_SUCCESS_ROUTE,
  TORNEO_RESUMEN_REQUESTS_METRIC,
  TORNEO_RESUMEN_ROUTE,
} from "../../src/observability/metrics";
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

const canaryIdentity = {
  version: "4.0.0",
  track: "canary",
} as const;

const torneo = {
  id: 1,
  nombre: "Torneo Universitario",
  deporte: "Futbol",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-09-15",
  estado: "PROGRAMADO",
};

async function collectPoints(
  reader: CollectingMetricReader,
): Promise<MetricPoint[]> {
  const result = await reader.collect();
  const points: MetricPoint[] = [];

  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const dataPoint of metric.dataPoints) {
        const serialized = JSON.stringify(dataPoint.attributes);
        expect(serialized).not.toMatch(/\/api\/v4\/torneos\/\d+/);
        expect(dataPoint.attributes).not.toHaveProperty("traceId");

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

function pointsNamed(points: MetricPoint[], name: string): MetricPoint[] {
  return points.filter((point) => point.name === name);
}

describe("Métricas exclusivas Sports API v4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("200 incrementa resumen una vez con outcome=success y RED/duration", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({
      id: 1,
      duracionDias: 15,
    });
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");

    const points = await collectPoints(reader);

    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(1);
    expect(
      pointsNamed(points, TORNEO_RESUMEN_REQUESTS_METRIC)[0]?.attributes,
    ).toEqual({
      [API_VERSION_ATTR]: "4.0.0",
      [API_TRACK_ATTR]: "canary",
      "http.route": TORNEO_RESUMEN_ROUTE,
      [OUTCOME_ATTR]: "success",
    });

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(0);
    expect(
      pointsNamed(points, "http.server.requests")[0]?.attributes,
    ).toMatchObject({
      "http.route": TORNEO_RESUMEN_ROUTE,
      "http.status_code": 200,
      [API_VERSION_ATTR]: "4.0.0",
      [API_TRACK_ATTR]: "canary",
    });

    const duration = pointsNamed(points, "http.server.request.duration");
    expect(duration).toHaveLength(1);
    expect(duration[0].unit).toBe("s");
    expect((duration[0].value as Histogram).count).toBe(1);

    await app.close();
  });

  it("400 incrementa resumen con outcome=client_error", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/abc/resumen",
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toEqual({
      message: "El identificador debe ser un número entero positivo",
    });

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(1);
    expect(
      pointsNamed(points, TORNEO_RESUMEN_REQUESTS_METRIC)[0]?.attributes,
    ).toMatchObject({
      [OUTCOME_ATTR]: "client_error",
      "http.route": TORNEO_RESUMEN_ROUTE,
      [API_TRACK_ATTR]: "canary",
      [API_VERSION_ATTR]: "4.0.0",
    });
    expect(buscarPorId).not.toHaveBeenCalled();

    await app.close();
  });

  it("404 incrementa resumen con outcome=client_error", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(null);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/999/resumen",
    });

    expect(respuesta.statusCode).toBe(404);

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(1);
    expect(
      pointsNamed(points, TORNEO_RESUMEN_REQUESTS_METRIC)[0]?.attributes[
        OUTCOME_ATTR
      ],
    ).toBe("client_error");
    expect(
      JSON.stringify(
        pointsNamed(points, TORNEO_RESUMEN_REQUESTS_METRIC)[0]?.attributes,
      ),
    ).not.toContain("999");
    expect(
      pointsNamed(points, "http.server.requests")[0]?.attributes["http.route"],
    ).toBe(TORNEO_RESUMEN_ROUTE);

    await app.close();
  });

  it("500 controlado incrementa resumen con outcome=server_error", async () => {
    vi.mocked(buscarPorId).mockResolvedValue({
      ...torneo,
      fechaInicio: "2026-09-15",
      fechaFin: "2026-09-01",
    } as never);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({
      message: "Error interno al calcular el resumen",
    });

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(1);
    expect(
      pointsNamed(points, TORNEO_RESUMEN_REQUESTS_METRIC)[0]?.attributes[
        OUTCOME_ATTR
      ],
    ).toBe("server_error");

    await app.close();
  });

  it("ruta v4 inexistente no incrementa el contador de resumen", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/no-existe",
    });

    expect(respuesta.statusCode).toBe(404);

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(0);
    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(
      pointsNamed(points, "http.server.requests")[0]?.attributes["http.route"],
    ).toBe("unmatched");

    await app.close();
  });

  it("healthchecks no incrementan el contador de resumen", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const live = await app.inject({ method: "GET", url: "/health/live" });
    expect(live.statusCode).toBe(200);

    const points = await collectPoints(reader);
    expect(points).toEqual([]);
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(0);

    await app.close();
  });

  it("lookup.success compartido sigue funcionando junto a métricas v4", async () => {
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
    });

    const lookup = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
    });
    const resumen = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });

    expect(lookup.statusCode).toBe(200);
    expect(resumen.statusCode).toBe(200);
    expect(lookup.json()).toEqual(torneo);
    expect(resumen.json()).toHaveProperty("duracionDias", 15);

    const points = await collectPoints(reader);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(1);
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(1);
    expect(
      pointsNamed(points, TORNEO_LOOKUP_SUCCESS_METRIC)[0]?.attributes[
        "http.route"
      ],
    ).toBe(TORNEO_LOOKUP_SUCCESS_ROUTE);
    expect(counterTotal(points, "http.server.requests")).toBe(2);

    await app.close();
  });
});
