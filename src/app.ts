import Fastify from "fastify";
import { torneoRoutes } from "./routes/torneo.routes";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/", async () => {
    return {
      message: "API de Torneos Deportivos funcionando",
    };
  });

  app.register(torneoRoutes);

  return app;
}