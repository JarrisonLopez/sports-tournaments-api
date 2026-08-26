import { FastifyInstance } from "fastify";
import { AppDataSource } from "../config/database";
import { Cancha } from "../entities/Cancha";

export async function canchaRoutes(app: FastifyInstance) {
  const canchaRepository = AppDataSource.getRepository(Cancha);

  // Crear una cancha
  app.post("/canchas", async (request, reply) => {
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

    const cancha = canchaRepository.create({
      nombre,
      ubicacion,
      tipoSuperficie,
      disponible,
    });

    const canchaGuardada = await canchaRepository.save(cancha);

    return reply.code(201).send(canchaGuardada);
  });
}