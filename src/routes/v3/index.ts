import { FastifyInstance } from "fastify";

import { crearArtifactTorneo } from "../../controllers/v3-artifact.controller";

export async function v3Routes(app: FastifyInstance) {
  app.post("/torneos/:id/artifact", crearArtifactTorneo);
}
