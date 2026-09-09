import { FastifyInstance } from "fastify";

import { torneoRoutes } from "../torneo.routes";
import { canchaRoutes } from "../cancha.routes";
import { jugadorRoutes } from "../jugador.routes";

export async function v2Routes(app: FastifyInstance) {
  app.register(torneoRoutes);
  app.register(canchaRoutes);
  app.register(jugadorRoutes);
}