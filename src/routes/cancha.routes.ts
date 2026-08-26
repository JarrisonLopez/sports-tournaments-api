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

  // Consultar todas las canchas
  app.get("/canchas", async (_request, reply) => {
    const canchas = await canchaRepository.find();

    return reply.code(200).send(canchas);
  });

  // Consultar una cancha por ID
  app.get("/canchas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const cancha = await canchaRepository.findOneBy({
      id: Number(id),
    });

    if (!cancha) {
      return reply.code(404).send({
        message: "Cancha no encontrada",
      });
    }

    return reply.code(200).send(cancha);
  });

  // Actualizar una cancha
  app.patch("/canchas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const cancha = await canchaRepository.findOneBy({
      id: Number(id),
    });

    if (!cancha) {
      return reply.code(404).send({
        message: "Cancha no encontrada",
      });
    }

    const datos = request.body as {
      nombre?: string;
      ubicacion?: string;
      tipoSuperficie?: string;
      disponible?: boolean;
    };

    canchaRepository.merge(cancha, datos);

    const canchaActualizada = await canchaRepository.save(cancha);

    return reply.code(200).send(canchaActualizada);
  });
  
}