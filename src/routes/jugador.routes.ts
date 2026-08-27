import { FastifyInstance } from "fastify";
import { AppDataSource } from "../config/database";
import { Jugador } from "../entities/Jugador";

export async function jugadorRoutes(app: FastifyInstance) {
  const jugadorRepository = AppDataSource.getRepository(Jugador);

  // Crear un jugador
  app.post("/jugadores", async (request, reply) => {
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

    const jugador = jugadorRepository.create({
      nombre,
      documento,
      fechaNacimiento,
      posicion,
    });

    const jugadorGuardado = await jugadorRepository.save(jugador);

    return reply.code(201).send(jugadorGuardado);
  });
}