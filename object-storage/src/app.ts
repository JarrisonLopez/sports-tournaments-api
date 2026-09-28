import Fastify from "fastify";
import { MetricReader } from "@opentelemetry/sdk-metrics";

import { artifactRoutes } from "./routes/artifact.routes";
import { healthRoutes } from "./routes/health.routes";
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
    createHttpMetrics("object-storage", options.metricsReader),
  );

  app.register(healthRoutes);

  app.register(artifactRoutes, {
    prefix: "/api/v2",
  });

  return app;
}
