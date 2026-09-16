import { FastifyInstance } from "fastify";

import {
  actualizarJugador,
  crearJugador,
  eliminarJugador,
  listarJugadores,
  obtenerJugador,
} from "../controllers/jugador.controller";

export async function jugadorRoutes(app: FastifyInstance) {
  app.post("/jugadores", crearJugador);
  app.get("/jugadores", listarJugadores);
  app.get("/jugadores/:id", obtenerJugador);
  app.patch("/jugadores/:id", actualizarJugador);
  app.delete("/jugadores/:id", eliminarJugador);
}
