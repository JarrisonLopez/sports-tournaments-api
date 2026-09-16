import { FastifyReply, FastifyRequest } from "fastify";

import * as torneoService from "../services/torneo.service";

export async function crearTorneo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const {
    nombre,
    deporte,
    fechaInicio,
    fechaFin,
    estado,
  } = request.body as {
    nombre: string;
    deporte: string;
    fechaInicio: string;
    fechaFin: string;
    estado?: string;
  };

  const torneoGuardado = await torneoService.crear({
    nombre,
    deporte,
    fechaInicio,
    fechaFin,
    estado,
  });

  return reply.code(201).send(torneoGuardado);
}

export async function listarTorneos(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { deporte, estado } = request.query as {
    deporte?: string;
    estado?: string;
  };

  const torneos = await torneoService.listar({
    deporte,
    estado,
  });

  return reply.code(200).send(torneos);
}

export async function obtenerTorneo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const torneo = await torneoService.buscarPorId(Number(id));

  if (!torneo) {
    return reply.code(404).send({
      message: "Torneo no encontrado",
    });
  }

  return reply.code(200).send(torneo);
}

export async function actualizarTorneo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const datos = request.body as {
    nombre?: string;
    deporte?: string;
    fechaInicio?: string;
    fechaFin?: string;
    estado?: string;
  };

  const torneoActualizado = await torneoService.actualizar(Number(id), datos);

  if (!torneoActualizado) {
    return reply.code(404).send({
      message: "Torneo no encontrado",
    });
  }

  return reply.code(200).send(torneoActualizado);
}

export async function eliminarTorneo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const torneoEliminado = await torneoService.eliminar(Number(id));

  if (!torneoEliminado) {
    return reply.code(404).send({
      message: "Torneo no encontrado",
    });
  }

  return reply.code(200).send({
    message: "Torneo eliminado correctamente",
  });
}
