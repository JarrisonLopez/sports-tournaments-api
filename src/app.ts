import { trace } from "@opentelemetry/api";
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import { MetricReader } from "@opentelemetry/sdk-metrics";

import { torneoRoutes } from "./routes/torneo.routes";
import { canchaRoutes } from "./routes/cancha.routes";
import { jugadorRoutes } from "./routes/jugador.routes";
import { healthRoutes } from "./routes/health.routes";
import { v2Routes } from "./routes/v2";
import {
  createHttpMetrics,
  registerRedMetrics,
  resolveHttpRoute,
} from "./observability/metrics";

export type BuildAppOptions = {
  metricsReader?: MetricReader;
  logger?: FastifyServerOptions["logger"];
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  registerServerSpanRoute(app);
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

function registerServerSpanRoute(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    const span = trace.getActiveSpan();

    if (!span) {
      return;
    }

    const route = resolveHttpRoute(request);
    span.updateName(`${request.method} ${route}`);
    span.setAttribute("http.route", route);
  });
}