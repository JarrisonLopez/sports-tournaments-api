import { FastifyReply, FastifyRequest } from "fastify";

import * as canchaService from "../services/cancha.service";

export async function crearCancha(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const {
    nombre,
    ubicacion,
    tipoSuperficie,
    disponible,
  } = request.body as {
    nombre: string;
    ubicacion: string;
    tipoSuperficie: string;
    disponible?: boolean;
  };

  const canchaGuardada = await canchaService.crear({
    nombre,
    ubicacion,
    tipoSuperficie,
    disponible,
  });

  return reply.code(201).send(canchaGuardada);
}

export async function listarCanchas(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { tipoSuperficie, disponible } = request.query as {
    tipoSuperficie?: string;
    disponible?: string;
  };

  const canchas = await canchaService.listar({
    tipoSuperficie,
    disponible,
  });

  return reply.code(200).send(canchas);
}

export async function obtenerCancha(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const cancha = await canchaService.buscarPorId(Number(id));

  if (!cancha) {
    return reply.code(404).send({
      message: "Cancha no encontrada",
    });
  }

  return reply.code(200).send(cancha);
}

export async function actualizarCancha(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const datos = request.body as {
    nombre?: string;
    ubicacion?: string;
    tipoSuperficie?: string;
    disponible?: boolean;
  };

  const canchaActualizada = await canchaService.actualizar(Number(id), datos);

  if (!canchaActualizada) {
    return reply.code(404).send({
      message: "Cancha no encontrada",
    });
  }

  return reply.code(200).send(canchaActualizada);
}

export async function eliminarCancha(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const canchaEliminada = await canchaService.eliminar(Number(id));

  if (!canchaEliminada) {
    return reply.code(404).send({
      message: "Cancha no encontrada",
    });
  }

  return reply.code(200).send({
    message: "Cancha eliminada correctamente",
  });
}
