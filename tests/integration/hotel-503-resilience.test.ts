/**
 * Simula Hotel HTTP 503 en servidor local (sin OCI) y valida R0 vs R1.
 */
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  buscarPorId: vi.fn(),
}));

import { buscarPorId } from "../../src/services/torneo.service";
import {
  obtenerHabitacion,
  resetHotelCircuitBreakerForTests,
} from "../../src/clients/hotel.client";
import { ejecutar } from "../../src/services/flujo.service";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve(addr.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("Hotel HTTP 503 resilience (local mock server)", () => {
  let hotel: http.Server;
  let cine: http.Server;
  let hotelUrl: string;
  let cineUrl: string;
  let hotelHits: number;

  beforeEach(async () => {
    hotelHits = 0;
    hotel = http.createServer((_req, res) => {
      hotelHits += 1;
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "hotel unavailable (lab 503)" }));
    });
    cine = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const m = url.pathname.match(/^\/api\/v2\/peliculas\/(\d+)$/);
      if (m) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: Number(m[1]),
            nombre: "Lab Cine",
            duracion: 90,
            genero: "demo",
            descripcion: "cine mock local 503",
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    const hotelPort = await listen(hotel);
    const cinePort = await listen(cine);
    hotelUrl = `http://127.0.0.1:${hotelPort}`;
    cineUrl = `http://127.0.0.1:${cinePort}`;

    process.env.HOTEL_API_URL = hotelUrl;
    process.env.CINE_API_URL = cineUrl;
    process.env.OBJECT_STORAGE_API_URL = "";
    process.env.FLUJO_ORCHESTRATION_MODE = "sequential";
    process.env.CHAOS_LAB_ENABLED = "false";

    vi.mocked(buscarPorId).mockResolvedValue({
      id: 1,
      nombre: "Torneo Lab 503",
      deporte: "futbol",
      fechaInicio: "2026-01-01",
      fechaFin: "2026-01-02",
    } as never);

    resetHotelCircuitBreakerForTests();
  });

  afterEach(async () => {
    resetHotelCircuitBreakerForTests();
    await close(hotel);
    await close(cine);
    delete process.env.RESILIENCE_ENABLED;
    delete process.env.HOTEL_FALLBACK_ENABLED;
    delete process.env.HOTEL_TIMEOUT_MS;
    delete process.env.HOTEL_CB_FAILURE_THRESHOLD;
    delete process.env.HOTEL_CB_OPEN_MS;
  });

  it("R0: flujo falla ante HTTP 503 (sin timeout/CB/fallback)", async () => {
    process.env.RESILIENCE_ENABLED = "false";
    process.env.HOTEL_FALLBACK_ENABLED = "false";
    process.env.HOTEL_TIMEOUT_MS = "2000";

    await expect(
      ejecutar({
        torneoId: 1,
        habitacionId: 1,
        peliculaId: 1,
        traceId: "local-503-r0",
      }),
    ).rejects.toMatchObject({ name: "HotelRequestError", status: 503 });

    expect(hotelHits).toBe(1);

    await expect(
      obtenerHabitacion(1, "r0-direct", {
        env: {
          HOTEL_API_URL: hotelUrl,
          RESILIENCE_ENABLED: "false",
          HOTEL_FALLBACK_ENABLED: "false",
        },
      }),
    ).rejects.toMatchObject({ name: "HotelRequestError", status: 503 });
  });

  it("R1: flujo 200 partial con fallback ante HTTP 503 (no confundir con full)", async () => {
    process.env.RESILIENCE_ENABLED = "true";
    process.env.HOTEL_FALLBACK_ENABLED = "true";
    process.env.HOTEL_TIMEOUT_MS = "2000";
    process.env.HOTEL_CB_FAILURE_THRESHOLD = "10";

    const result = await ejecutar({
      torneoId: 1,
      habitacionId: 1,
      peliculaId: 1,
      traceId: "local-503-r1",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("partial");
    expect(result!.degraded).toBe(true);
    expect(result!.degradedDependencies).toContain("hotel");
    expect(result!.habitacion.origenResiliencia).toBe("fallback");
    expect(result!.providers.hotel.via).toBe("fallback");
    expect(result!.pelicula).toMatchObject({ id: 1 });
    // HTTP 200 en capa controller, pero clasificación = partial ≠ full.
    expect(result!.status).not.toBe("success");
    expect(hotelHits).toBe(1);
  });

  it("R1: circuit breaker corta llamadas a Hotel tras umbral de 503", async () => {
    process.env.RESILIENCE_ENABLED = "true";
    process.env.HOTEL_FALLBACK_ENABLED = "true";
    process.env.HOTEL_TIMEOUT_MS = "2000";
    process.env.HOTEL_CB_FAILURE_THRESHOLD = "2";
    process.env.HOTEL_CB_OPEN_MS = "30000";

    await ejecutar({
      torneoId: 1,
      habitacionId: 1,
      peliculaId: 1,
      traceId: "local-503-cb-1",
    });
    await ejecutar({
      torneoId: 1,
      habitacionId: 1,
      peliculaId: 1,
      traceId: "local-503-cb-2",
    });
    expect(hotelHits).toBe(2);

    const third = await ejecutar({
      torneoId: 1,
      habitacionId: 1,
      peliculaId: 1,
      traceId: "local-503-cb-3",
    });
    expect(third!.status).toBe("partial");
    expect(hotelHits).toBe(2);
  });
});
