import { FastifyInstance } from "fastify";

import { live, ready } from "../controllers/health.controller";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health/live", live);
  app.get("/health/ready", ready);
}
