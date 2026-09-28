import { FastifyInstance } from "fastify";

import {
  createArtifact,
  getArtifact,
} from "../controllers/artifact.controller";

export async function artifactRoutes(app: FastifyInstance) {
  app.post("/artifacts", createArtifact);
  app.get("/artifacts/:traceId", getArtifact);
}
