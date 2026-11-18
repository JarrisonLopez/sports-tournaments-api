import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MetricReader,
  type Attributes,
  type Histogram,
} from "@opentelemetry/sdk-metrics";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
  buscarProximos: vi.fn(),
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
  TORNEO_RESUMEN_REQUESTS_METRIC,
} from "../../src/observability/metrics";
import { buscarPorId, buscarProximos } from "../../src/services/torneo.service";

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

const referencia = new Date("2026-11-05T15:00:00.000Z");

const proximos = [
  {
    id: 4,
    nombre: "Copa Andina",
    deporte: "Futbol",
    estado: "PROGRAMADO",
    fechaInicio: "2026-11-05",
    fechaFin: "2026-11-07",
  },
  {
    id: 9,
    nombre: "Liga Costa",
    deporte: "Baloncesto",
    estado: "PROGRAMADO",
    fechaInicio: "2026-11-12",
    fechaFin: "2026-11-18",
  },
];

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

describe("GET /api/v4/torneos/proximos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(referencia);
  });

  it("devuelve próximos en el orden de la consulta y cabeceras de identidad", async () => {
    vi.mocked(buscarProximos).mockResolvedValue(proximos as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/proximos",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual(proximos);
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");
    expect(buscarProximos).toHaveBeenCalledWith({
      fechaInicioDesde: "2026-11-05",
      limite: 20,
    });

    await app.close();
    vi.useRealTimers();
  });

  it("aplica un límite válido y rechaza inválidos o excesivos", async () => {
    vi.mocked(buscarProximos).mockResolvedValue([proximos[0]] as never);

    const app = buildApp({ logger: false, identity: canaryIdentity });

    const valido = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/proximos?limite=5",
    });
    expect(valido.statusCode).toBe(200);
    expect(buscarProximos).toHaveBeenCalledWith({
      fechaInicioDesde: "2026-11-05",
      limite: 5,
    });

    for (const limite of ["0", "-1", "1.5", "abc", "51"]) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/api/v4/torneos/proximos?limite=${limite}`,
      });

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.json()).toEqual({
        message: "El límite debe ser un entero entre 1 y 50",
      });
    }

    expect(buscarProximos).toHaveBeenCalledTimes(1);

    await app.close();
    vi.useRealTimers();
  });

  it("devuelve colección vacía sin consultar el resumen", async () => {
    vi.mocked(buscarProximos).mockResolvedValue([]);

    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      metricsReader: reader,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/proximos",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual([]);

    const points = await collectPoints(reader);
    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(
      points.find((point) => point.name === "http.server.requests")?.attributes,
    ).toMatchObject({
      "http.method": "GET",
      "http.route": "/api/v4/torneos/proximos",
      "http.status_code": 200,
      "api.version": "4.0.0",
      "api.track": "canary",
    });
    expect(counterTotal(points, TORNEO_RESUMEN_REQUESTS_METRIC)).toBe(0);

    await app.close();
    vi.useRealTimers();
  });

  it("responde 500 genérico si la consulta falla", async () => {
    vi.mocked(buscarProximos).mockRejectedValue(new Error("sql down"));

    const app = buildApp({ logger: false, identity: canaryIdentity });
    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/proximos",
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({
      message: "Error interno al consultar torneos próximos",
    });
    expect(JSON.stringify(respuesta.json())).not.toContain("sql");

    await app.close();
    vi.useRealTimers();
  });

  it("no altera el resumen v4 ni la consulta v2", async () => {
    vi.mocked(buscarPorId).mockResolvedValue({
      id: 1,
      nombre: "Torneo Universitario",
      deporte: "Futbol",
      fechaInicio: "2026-09-01",
      fechaFin: "2026-09-15",
      estado: "PROGRAMADO",
    } as never);
    vi.mocked(buscarProximos).mockResolvedValue([]);

    const app = buildApp({ logger: false, identity: canaryIdentity });

    const resumen = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
    });
    const consulta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
    });
    const lista = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/proximos",
    });

    expect(resumen.statusCode).toBe(200);
    expect(resumen.json()).toMatchObject({ id: 1, duracionDias: 15 });
    expect(consulta.statusCode).toBe(200);
    expect(consulta.json()).toMatchObject({ id: 1, nombre: "Torneo Universitario" });
    expect(lista.statusCode).toBe(200);
    expect(lista.json()).toEqual([]);

    await app.close();
    vi.useRealTimers();
  });
});
