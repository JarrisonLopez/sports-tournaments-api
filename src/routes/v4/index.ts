import { FastifyInstance } from "fastify";

import { obtenerEstadisticasTorneos } from "../../controllers/v4-torneo-estadisticas.controller";
import { obtenerTorneosProximos } from "../../controllers/v4-torneo-proximos.controller";
import { obtenerResumenTorneo } from "../../controllers/v4-torneo-resumen.controller";

export async function v4Routes(app: FastifyInstance) {
  app.get("/torneos/estadisticas", obtenerEstadisticasTorneos);
  app.get("/torneos/proximos", obtenerTorneosProximos);
  app.get("/torneos/:id/resumen", obtenerResumenTorneo);
}
