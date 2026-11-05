import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MetricReader,
  type Attributes,
  type Histogram,
} from "@opentelemetry/sdk-metrics";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
  buscarProximos: vi.fn(),
  consultarEstadisticasTorneos: vi.fn(),
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
  TORNEO_LOOKUP_SUCCESS_METRIC,
  TORNEO_RESUMEN_REQUESTS_METRIC,
} from "../../src/observability/metrics";
import {
  buscarPorId,
  buscarProximos,
  consultarEstadisticasTorneos,
} from "../../src/services/torneo.service";

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
  attributes: Attributes;
  value: number | Histogram;
};

const canaryIdentity = {
  version: "4.0.0",
  track: "canary",
} as const;

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

describe("GET /api/v4/torneos/estadisticas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responde el contrato agregado y las cabeceras de identidad", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: "2",
      porDeporte: [{ deporte: "Futbol", cantidad: "2" }],
      porEstado: [{ estado: "EN_CURSO", cantidad: "2" }],
    });

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/estadisticas",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      totalTorneos: 2,
      porDeporte: [{ deporte: "Futbol", cantidad: 2 }],
      porEstado: [{ estado: "EN_CURSO", cantidad: 2 }],
    });
    expect(Object.keys(respuesta.json()).sort()).toEqual([
      "porDeporte",
      "porEstado",
      "totalTorneos",
    ]);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");
    expect(buscarPorId).not.toHaveBeenCalled();

    await app.close();
  });

  it("registra RED de la plantilla estática y no las métricas de otros endpoints", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: 1,
      porDeporte: [{ deporte: "Tenis", cantidad: 1 }],
      porEstado: [{ estado: "PROGRAMADO", cantidad: 1 }],
    });

    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      metricsReader: reader,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/estadisticas",
    });

    expect(respuesta.statusCode).toBe(200);

    const points = await collectPoints(reader);
    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(
      points.find((point) => point.name === "http.server.requests")?.attributes,
    ).toMatchObject({
      "http.method": "GET",
      "http.route": "/api/v4/torneos/estadisticas",
      "http.status_code": 200,
      "api.version": "4.0.0",
      "api.track": "canary",
    });
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(0);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(0);

    await app.close();
  });

  it("responde 500 genérico si la agregación falla", async () => {
    vi.mocked(consultarEstadisticasTorneos).mockRejectedValue(
      new Error("Table torneos doesn't exist"),
    );

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/estadisticas",
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({
      message: "Error interno al consultar estadísticas",
    });
    expect(JSON.stringify(respuesta.json())).not.toContain("torneos");

    await app.close();
  });

  it("no intercepta el resumen ni próximos y no cambia la consulta v2", async () => {
    vi.mocked(buscarPorId).mockResolvedValue({
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      estado: "PROGRAMADO",
    } as never);
    vi.mocked(buscarProximos).mockResolvedValue([]);
    vi.mocked(consultarEstadisticasTorneos).mockResolvedValue({
      total: "1",
      porDeporte: [{ deporte: "Futbol", cantidad: "1" }],
      porEstado: [{ estado: "PROGRAMADO", cantidad: "1" }],
    });

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const estadisticas = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/estadisticas",
    });
    const resumen = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });
    const proximos = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/proximos",
    });
    const consulta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
    });

    expect(estadisticas.statusCode).toBe(200);
    expect(estadisticas.json()).toMatchObject({ totalTorneos: 1 });
    expect(resumen.statusCode).toBe(200);
    expect(resumen.json()).toMatchObject({ id: 1, duracionDias: 15 });
    expect(proximos.statusCode).toBe(200);
    expect(proximos.json()).toEqual([]);
    expect(consulta.statusCode).toBe(200);
    expect(consulta.json()).toMatchObject({
      id: 1,
      nombre: "Torneo Universitario",
    });

    await app.close();
  });
});
