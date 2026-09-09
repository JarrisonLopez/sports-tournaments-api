import Fastify from "fastify";
import { torneoRoutes } from "./routes/torneo.routes";
import { canchaRoutes } from "./routes/cancha.routes";
import { jugadorRoutes } from "./routes/jugador.routes";
import { v2Routes } from "./routes/v2";

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
  app.register(jugadorRoutes);
  
  app.register(v2Routes, {
    prefix: "/api/v2",
  });

  return app;
}