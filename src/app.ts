import Fastify from "fastify";
import { torneoRoutes } from "./routes/torneo.routes";
import { canchaRoutes } from "./routes/cancha.routes";

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
  app.register(canchaRoutes);

  return app;
}