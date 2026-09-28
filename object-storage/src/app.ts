import Fastify from "fastify";

import { artifactRoutes } from "./routes/artifact.routes";
import { healthRoutes } from "./routes/health.routes";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoutes);

  app.register(artifactRoutes, {
    prefix: "/api/v2",
  });

  return app;
}
