import {
  FastifyInstance,
  preHandlerAsyncHookHandler,
  preHandlerHookHandler,
} from "fastify";

import {
  actualizarTorneo,
  crearTorneo,
  eliminarTorneo,
  listarTorneos,
  obtenerTorneo,
} from "../controllers/torneo.controller";

export type TorneoRoutesOptions = {
  /** preHandler opcional solo para GET /torneos/:id (p. ej. fault injection en v2). */
  getTorneoPreHandler?:
    | preHandlerHookHandler
    | preHandlerAsyncHookHandler
    | (preHandlerHookHandler | preHandlerAsyncHookHandler)[];
};

export async function torneoRoutes(
  app: FastifyInstance,
  opts: TorneoRoutesOptions = {},
) {
  app.post("/torneos", crearTorneo);
  app.get("/torneos", listarTorneos);

  if (opts.getTorneoPreHandler) {
    app.get(
      "/torneos/:id",
      { preHandler: opts.getTorneoPreHandler },
      obtenerTorneo,
    );
  } else {
    app.get("/torneos/:id", obtenerTorneo);
  }

  app.patch("/torneos/:id", actualizarTorneo);
  app.delete("/torneos/:id", eliminarTorneo);
}
