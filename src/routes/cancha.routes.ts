import { FastifyInstance } from "fastify";

import {
  actualizarCancha,
  crearCancha,
  eliminarCancha,
  listarCanchas,
  obtenerCancha,
} from "../controllers/cancha.controller";

export async function canchaRoutes(app: FastifyInstance) {
  app.post("/canchas", crearCancha);
  app.get("/canchas", listarCanchas);
  app.get("/canchas/:id", obtenerCancha);
  app.patch("/canchas/:id", actualizarCancha);
  app.delete("/canchas/:id", eliminarCancha);
}
