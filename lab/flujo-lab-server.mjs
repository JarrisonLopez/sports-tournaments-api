#!/usr/bin/env node
/**
 * Servidor de laboratorio: Sports (sin MySQL) + mocks Hotel/Cine.
 * Expone /api/v2/flujo, /chaos/* y health para k6 y Chaos Toolkit.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import Module from "node:module";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sportsPort = Number(process.env.SPORTS_LAB_PORT || 8080);
const hotelPort = Number(process.env.HOTEL_MOCK_PORT || 8081);
const cinePort = Number(process.env.CINE_MOCK_PORT || 8082);

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
            nombre: "Torneo Lab",
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

function startMock(port, kind) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (kind === "hotel") {
        const m = url.pathname.match(/^\/api\/v2\/habitacion\/(\d+)$/);
        if (m) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: Number(m[1]),
              numeroHabitacion: "101",
              precioHabitacion: 100,
              estadoHabitacion: "disponible",
              tipoHabitacion: "standard",
            }),
          );
          return;
        }
      }
      if (kind === "cine") {
        const m = url.pathname.match(/^\/api\/v2\/peliculas\/(\d+)$/);
        if (m) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: Number(m[1]),
              nombre: "Pelicula Lab",
              duracion: 90,
              genero: "demo",
              descripcion: "lab",
            }),
          );
          return;
        }
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
process.env.CHAOS_LAB_ENABLED = process.env.CHAOS_LAB_ENABLED || "true";
process.env.CHAOS_FAULT_TOKEN =
  process.env.CHAOS_FAULT_TOKEN || "chaos-lab-token-minimo-32-chars!!";
delete process.env.OBJECT_STORAGE_API_URL;

const hotel = await startMock(hotelPort, "hotel");
const cine = await startMock(cinePort, "cine");

const require = createRequire(resolve(root, "package.json"));
const { startTracing } = require("./dist/instrumentation.js");
const { buildApp } = require("./dist/app.js");
startTracing({ spanProcessors: [] });

const app = buildApp({
  logger: false,
  env: process.env,
  identity: { version: "4.1.1", track: "lab" },
});

// Laboratorio sin MySQL: ready de producto fallaría; exponemos /lab/ready.
app.get("/lab/ready", async () => ({ status: "ok", mode: "lab-no-mysql" }));

app.get("/lab/resilience", async () => ({
  RESILIENCE_ENABLED: process.env.RESILIENCE_ENABLED === "true",
  HOTEL_FALLBACK_ENABLED: process.env.HOTEL_FALLBACK_ENABLED !== "false",
  HOTEL_TIMEOUT_MS: process.env.HOTEL_TIMEOUT_MS || "400",
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
  if (body.hotelTimeoutMs) {
    process.env.HOTEL_TIMEOUT_MS = String(body.hotelTimeoutMs);
  }
  return {
    RESILIENCE_ENABLED: process.env.RESILIENCE_ENABLED === "true",
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
