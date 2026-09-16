import { FastifyInstance } from "fastify";

import { ejecutarFlujo } from "../../controllers/flujo.controller";

export async function flujoRoutes(app: FastifyInstance) {
  app.get(
    "/flujo/:torneoId/:habitacionId/:peliculaId",
    ejecutarFlujo,
  );
}
