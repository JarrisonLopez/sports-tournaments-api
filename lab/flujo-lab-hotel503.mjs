#!/usr/bin/env node
/**
 * Lab local para validar Hotel HTTP 503 (sin OCI).
 * Hotel mock → siempre 503. Cine mock → 200. Sports sin MySQL.
 *
 *   SPORTS_LAB_PORT=18080 node lab/flujo-lab-hotel503.mjs
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import Module from "node:module";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sportsPort = Number(process.env.SPORTS_LAB_PORT || 18080);
const hotelPort = Number(process.env.HOTEL_MOCK_PORT || 18081);
const cinePort = Number(process.env.CINE_MOCK_PORT || 18082);

execSync("npx tsc -p tsconfig.json --pretty false", { cwd: root, stdio: "pipe" });

const torneoServicePath = fs.realpathSync(
  resolve(root, "dist/services/torneo.service.js"),
);
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  try {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (fs.realpathSync(resolved) === torneoServicePath) {
      return {
        async buscarPorId(id) {
          return {
            id,
            nombre: "Torneo Lab 503",
            deporte: "futbol",
            fechaInicio: "2026-01-01",
            fechaFin: "2026-01-02",
            estado: "PROGRAMADO",
          };
        },
      };
    }
  } catch {
    /* continue */
  }
  return originalLoad.apply(this, arguments);
};

function startHotel503(port) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname.includes("health")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      const m = url.pathname.match(/^\/api\/v2\/habitacion\/(\d+)$/);
      if (m) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "hotel unavailable (lab 503)" }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

function startCine(port) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const m = url.pathname.match(/^\/api\/v2\/peliculas\/(\d+)$/);
      if (m) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: Number(m[1]),
            nombre: "Pelicula Lab",
            duracion: 90,
            genero: "demo",
            descripcion: "cine mock local 503",
          }),
        );
        return;
      }
      if (url.pathname.includes("health")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

process.env.NODE_ENV = "test";
process.env.HOTEL_API_URL = `http://127.0.0.1:${hotelPort}`;
process.env.CINE_API_URL = `http://127.0.0.1:${cinePort}`;
process.env.FLUJO_ORCHESTRATION_MODE = "sequential";
process.env.CHAOS_LAB_ENABLED = "false";
process.env.CHAOS_FAULT_TOKEN =
  process.env.CHAOS_FAULT_TOKEN || "chaos-lab-token-minimo-32-chars!!";
process.env.RESILIENCE_ENABLED = process.env.RESILIENCE_ENABLED || "false";
process.env.HOTEL_FALLBACK_ENABLED =
  process.env.HOTEL_FALLBACK_ENABLED || "false";
process.env.HOTEL_TIMEOUT_MS = process.env.HOTEL_TIMEOUT_MS || "2000";
delete process.env.OBJECT_STORAGE_API_URL;

const hotel = await startHotel503(hotelPort);
const cine = await startCine(cinePort);

const require = createRequire(resolve(root, "package.json"));
const { startTracing } = require("./dist/instrumentation.js");
const { buildApp } = require("./dist/app.js");
const { resetHotelCircuitBreakerForTests } = require("./dist/clients/hotel.client.js");
startTracing({ spanProcessors: [] });

const app = buildApp({
  logger: false,
  env: process.env,
  identity: { version: "4.1.1", track: "lab-hotel503" },
});

app.get("/lab/ready", async () => ({
  status: "ok",
  mode: "lab-hotel503",
  hotelStatus: 503,
}));

app.get("/lab/resilience", async () => ({
  RESILIENCE_ENABLED: process.env.RESILIENCE_ENABLED === "true",
  HOTEL_FALLBACK_ENABLED: process.env.HOTEL_FALLBACK_ENABLED === "true",
  HOTEL_TIMEOUT_MS: process.env.HOTEL_TIMEOUT_MS || "2000",
  CHAOS_LAB_ENABLED: process.env.CHAOS_LAB_ENABLED === "true",
}));

app.post("/lab/resilience", async (request, reply) => {
  const token = request.headers["x-chaos-token"];
  if (token !== process.env.CHAOS_FAULT_TOKEN) {
    return reply.code(403).send({ message: "token inválido" });
  }
  const body = request.body || {};
  if (typeof body.enabled === "boolean") {
    process.env.RESILIENCE_ENABLED = body.enabled ? "true" : "false";
    process.env.HOTEL_FALLBACK_ENABLED = body.enabled ? "true" : "false";
  }
  if (typeof body.resilienceEnabled === "boolean") {
    process.env.RESILIENCE_ENABLED = body.resilienceEnabled ? "true" : "false";
  }
  if (typeof body.hotelFallbackEnabled === "boolean") {
    process.env.HOTEL_FALLBACK_ENABLED = body.hotelFallbackEnabled
      ? "true"
      : "false";
  }
  if (body.hotelTimeoutMs) {
    process.env.HOTEL_TIMEOUT_MS = String(body.hotelTimeoutMs);
  }
  resetHotelCircuitBreakerForTests();
  return {
    RESILIENCE_ENABLED: process.env.RESILIENCE_ENABLED === "true",
    HOTEL_FALLBACK_ENABLED: process.env.HOTEL_FALLBACK_ENABLED === "true",
    HOTEL_TIMEOUT_MS: process.env.HOTEL_TIMEOUT_MS,
  };
});

await app.listen({ port: sportsPort, host: "127.0.0.1" });
console.log(
  JSON.stringify({
    ready: true,
    sports: `http://127.0.0.1:${sportsPort}`,
    hotel: process.env.HOTEL_API_URL,
    cine: process.env.CINE_API_URL,
    hotelAlways: 503,
    CHAOS_LAB_ENABLED: false,
  }),
);

async function shutdown() {
  await app.close();
  hotel.close();
  cine.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
