import { FastifyReply, FastifyRequest } from "fastify";

import * as healthService from "../services/health.service";

export async function live(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.code(200).send({
    status: "ok",
  });
}

export async function ready(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  const databaseReady = await healthService.isDatabaseReady();

  if (!databaseReady) {
    return reply.code(503).send({
      status: "not_ready",
    });
  }

  return reply.code(200).send({
    status: "ready",
  });
}
