import { trace } from "@opentelemetry/api";
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import { MetricReader } from "@opentelemetry/sdk-metrics";

import { artifactRoutes } from "./routes/artifact.routes";
import { healthRoutes } from "./routes/health.routes";
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
    createHttpMetrics("object-storage", options.metricsReader),
  );

  app.register(healthRoutes);

  app.register(artifactRoutes, {
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
