import Fastify from "fastify";
import { MetricReader } from "@opentelemetry/sdk-metrics";

import { torneoRoutes } from "./routes/torneo.routes";
import { canchaRoutes } from "./routes/cancha.routes";
import { jugadorRoutes } from "./routes/jugador.routes";
import { healthRoutes } from "./routes/health.routes";
import { v2Routes } from "./routes/v2";
import { createHttpMetrics, registerRedMetrics } from "./observability/metrics";

export type BuildAppOptions = {
  metricsReader?: MetricReader;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
  });

  registerRedMetrics(
    app,
    createHttpMetrics("sports-api", options.metricsReader),
  );

  app.get("/", async () => {
    return {
      message: "API de Torneos Deportivos funcionando",
    };
  });

  app.register(healthRoutes);
  app.register(torneoRoutes);
  app.register(canchaRoutes);
  app.register(jugadorRoutes);

  app.register(v2Routes, {
    prefix: "/api/v2",
  });

  return app;
}