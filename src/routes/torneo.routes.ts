import { FastifyInstance } from "fastify";
import { AppDataSource } from "../config/database";
import { Torneo } from "../entities/Torneo";

export async function torneoRoutes(app: FastifyInstance) {
  const torneoRepository = AppDataSource.getRepository(Torneo);

  app.post("/torneos", async (request, reply) => {
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

    const torneo = torneoRepository.create({
      nombre,
      deporte,
      fechaInicio,
      fechaFin,
      estado,
    });

    const torneoGuardado = await torneoRepository.save(torneo);

    return reply.code(201).send(torneoGuardado);
  });
}