import { FastifyReply, FastifyRequest } from "fastify";

import { isBucketConfigured } from "../services/artifact-storage.service";

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
  if (!isBucketConfigured()) {
    return reply.code(503).send({
      status: "not_ready",
    });
  }

  return reply.code(200).send({
    status: "ready",
  });
}
