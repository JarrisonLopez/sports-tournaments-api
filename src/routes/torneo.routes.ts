import { FastifyInstance } from "fastify";

import {
  actualizarTorneo,
  crearTorneo,
  eliminarTorneo,
  listarTorneos,
  obtenerTorneo,
} from "../controllers/torneo.controller";

export async function torneoRoutes(app: FastifyInstance) {
  app.post("/torneos", crearTorneo);
  app.get("/torneos", listarTorneos);
  app.get("/torneos/:id", obtenerTorneo);
  app.patch("/torneos/:id", actualizarTorneo);
  app.delete("/torneos/:id", eliminarTorneo);
}
