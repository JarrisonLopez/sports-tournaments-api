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
  FAULT_MODE_ERROR,
  FAULT_MODE_HEADER,
  FAULT_TOKEN_HEADER,
  FAULT_INJECTION_TARGET_ROUTE,
  MIN_FAULT_TOKEN_LENGTH,
  type FaultInjectionConfig,
} from "../../src/config/fault-injection";
import {
  API_TRACK_HEADER,
  API_VERSION_HEADER,
  type RuntimeIdentity,
} from "../../src/config/runtime-identity";
import {
  API_TRACK_ATTR,
  API_VERSION_ATTR,
  TORNEO_LOOKUP_SUCCESS_METRIC,
} from "../../src/observability/metrics";
import { buscarPorId, listar } from "../../src/services/torneo.service";

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

/** Token ficticio de prueba (≥ MIN_FAULT_TOKEN_LENGTH); no es un secreto real. */
const TEST_TOKEN = "test-fault-token-xxxxxxxxxxxxxxxx";

const canaryIdentity: RuntimeIdentity = {
  version: "4.0.0",
  track: "canary",
};

const stableIdentity: RuntimeIdentity = {
  version: "3.0.1",
  track: "stable",
};

const armedConfig: FaultInjectionConfig = {
  enabled: true,
  token: TEST_TOKEN,
};

const torneo = {
  id: 1,
  nombre: "Torneo Universitario",
  deporte: "Futbol",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-09-15",
  estado: "PROGRAMADO",
};

const faultHeaders = {
  [FAULT_MODE_HEADER]: FAULT_MODE_ERROR,
  [FAULT_TOKEN_HEADER]: TEST_TOKEN,
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
        expect(serialized).not.toContain(TEST_TOKEN);
        expect(serialized).not.toMatch(/\/api\/v2\/torneos\/\d+/);

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

describe("Fault injection en GET /api/v2/torneos/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buscarPorId).mockResolvedValue(torneo as never);
  });

  it("A: canary + habilitado + token + modo error → 500 sin MySQL", async () => {
    expect(TEST_TOKEN.length).toBeGreaterThanOrEqual(MIN_FAULT_TOKEN_LENGTH);

    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: faultHeaders,
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({ message: "Error interno simulado" });
    expect(respuesta.headers[API_VERSION_HEADER]).toBe("4.0.0");
    expect(respuesta.headers[API_TRACK_HEADER]).toBe("canary");
    expect(buscarPorId).not.toHaveBeenCalled();
    expect(JSON.stringify(respuesta.json())).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(respuesta.headers)).not.toContain(TEST_TOKEN);

    await app.close();
  });

  it("B: stable + mismas cabeceras → funcionamiento normal", async () => {
    const app = buildApp({
      logger: false,
      identity: stableIdentity,
      faultInjection: armedConfig,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: faultHeaders,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual(torneo);
    expect(buscarPorId).toHaveBeenCalledWith(1);

    await app.close();
  });

  it("C: canary + mecanismo deshabilitado → funcionamiento normal", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: { enabled: false, token: TEST_TOKEN },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: faultHeaders,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(buscarPorId).toHaveBeenCalled();

    await app.close();
  });

  it("D: canary + token ausente o incorrecto → 403 genérico", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const sinToken = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: { [FAULT_MODE_HEADER]: FAULT_MODE_ERROR },
    });

    const tokenMalo = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: {
        [FAULT_MODE_HEADER]: FAULT_MODE_ERROR,
        [FAULT_TOKEN_HEADER]: "z".repeat(MIN_FAULT_TOKEN_LENGTH),
      },
    });

    expect(sinToken.statusCode).toBe(403);
    expect(sinToken.json()).toEqual({ message: "Acceso denegado" });
    expect(tokenMalo.statusCode).toBe(403);
    expect(tokenMalo.json()).toEqual({ message: "Acceso denegado" });
    expect(JSON.stringify(sinToken.json())).not.toMatch(/FAULT|token|canary/i);
    expect(buscarPorId).not.toHaveBeenCalled();

    await app.close();
  });

  it("E: canary + token correcto sin modo error → funcionamiento normal", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: { [FAULT_TOKEN_HEADER]: TEST_TOKEN },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(buscarPorId).toHaveBeenCalled();

    await app.close();
  });

  it("F: track unset/invalid → nunca inyecta", async () => {
    for (const track of ["unset", "invalid"] as const) {
      vi.mocked(buscarPorId).mockClear();

      const app = buildApp({
        logger: false,
        identity: { version: "4.0.0", track },
        faultInjection: armedConfig,
      });

      const respuesta = await app.inject({
        method: "GET",
        url: "/api/v2/torneos/1",
        headers: faultHeaders,
      });

      expect(respuesta.statusCode).toBe(200);
      expect(buscarPorId).toHaveBeenCalled();
      await app.close();
    }
  });

  it("G: sin cabeceras especiales → contrato anterior intacto", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual(torneo);

    await app.close();
  });

  it("H: otros métodos y rutas → sin inyección", async () => {
    vi.mocked(listar).mockResolvedValue([] as never);

    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const listado = await app.inject({
      method: "GET",
      url: "/api/v2/torneos",
      headers: faultHeaders,
    });
    expect(listado.statusCode).toBe(200);

    const root = await app.inject({
      method: "GET",
      url: "/torneos/1",
      headers: faultHeaders,
    });
    expect(root.statusCode).toBe(200);
    expect(root.json()).toEqual(torneo);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v2/torneos/1",
      headers: {
        ...faultHeaders,
        "content-type": "application/json",
      },
      payload: { nombre: "Otro" },
    });
    expect(patch.statusCode).not.toBe(500);
    expect(patch.statusCode).not.toBe(403);

    await app.close();
  });

  it("I: GET /api/v4/torneos/:id/resumen intacto", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v4/torneos/1/resumen",
      headers: faultHeaders,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({
      id: 1,
      duracionDias: 15,
    });
    expect(buscarPorId).toHaveBeenCalled();

    await app.close();
  });

  it("J: healthchecks sin cambios", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const live = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: faultHeaders,
    });

    expect(live.statusCode).toBe(200);

    await app.close();
  });

  it("L/M: RED refleja el 500 una vez con plantilla y track canary", async () => {
    const reader = new CollectingMetricReader();
    const app = buildApp({
      logger: false,
      metricsReader: reader,
      identity: canaryIdentity,
      faultInjection: armedConfig,
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: faultHeaders,
    });

    expect(respuesta.statusCode).toBe(500);

    const points = await collectPoints(reader);

    expect(counterTotal(points, "http.server.requests")).toBe(1);
    expect(counterTotal(points, "http.server.errors")).toBe(1);
    expect(counterTotal(points, TORNEO_LOOKUP_SUCCESS_METRIC)).toBe(0);

    expect(
      pointsNamed(points, "http.server.requests")[0]?.attributes,
    ).toMatchObject({
      "http.method": "GET",
      "http.route": FAULT_INJECTION_TARGET_ROUTE,
      "http.status_code": 500,
      [API_VERSION_ATTR]: "4.0.0",
      [API_TRACK_ATTR]: "canary",
    });

    const duration = pointsNamed(points, "http.server.request.duration");
    expect(duration).toHaveLength(1);
    expect(duration[0].unit).toBe("s");
    expect((duration[0].value as Histogram).count).toBe(1);

    await app.close();
  });

  it("O: token de entorno corto → comportamiento seguro (sin inyección)", async () => {
    const app = buildApp({
      logger: false,
      identity: canaryIdentity,
      faultInjection: {
        enabled: true,
        token: null,
      },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/torneos/1",
      headers: faultHeaders,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(buscarPorId).toHaveBeenCalled();

    await app.close();
  });
});
