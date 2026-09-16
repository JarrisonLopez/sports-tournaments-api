import { FastifyReply, FastifyRequest } from "fastify";

import * as jugadorService from "../services/jugador.service";

export async function crearJugador(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const {
    nombre,
    documento,
    fechaNacimiento,
    posicion,
  } = request.body as {
    nombre: string;
    documento: string;
    fechaNacimiento: string;
    posicion: string;
  };

  const jugadorGuardado = await jugadorService.crear({
    nombre,
    documento,
    fechaNacimiento,
    posicion,
  });

  return reply.code(201).send(jugadorGuardado);
}

export async function listarJugadores(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { nombre, posicion } = request.query as {
    nombre?: string;
    posicion?: string;
  };

  const jugadores = await jugadorService.listar({
    nombre,
    posicion,
  });

  return reply.code(200).send(jugadores);
}

export async function obtenerJugador(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const jugador = await jugadorService.buscarPorId(Number(id));

  if (!jugador) {
    return reply.code(404).send({
      message: "Jugador no encontrado",
    });
  }

  return reply.code(200).send(jugador);
}

export async function actualizarJugador(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const datos = request.body as {
    nombre?: string;
    documento?: string;
    fechaNacimiento?: string;
    posicion?: string;
  };

  const jugadorActualizado = await jugadorService.actualizar(Number(id), datos);

  if (!jugadorActualizado) {
    return reply.code(404).send({
      message: "Jugador no encontrado",
    });
  }

  return reply.code(200).send(jugadorActualizado);
}

export async function eliminarJugador(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id: string };

  const jugadorEliminado = await jugadorService.eliminar(Number(id));

  if (!jugadorEliminado) {
    return reply.code(404).send({
      message: "Jugador no encontrado",
    });
  }

  return reply.code(200).send({
    message: "Jugador eliminado correctamente",
  });
}
