import { FastifyInstance } from "fastify";

import { obtenerResumenTorneo } from "../../controllers/v4-torneo-resumen.controller";

export async function v4Routes(app: FastifyInstance) {
  app.get("/torneos/:id/resumen", obtenerResumenTorneo);
}
