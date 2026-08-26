import { FastifyInstance } from "fastify";
import { AppDataSource } from "../config/database";
import { Torneo } from "../entities/Torneo";

export async function torneoRoutes(app: FastifyInstance) {
  const torneoRepository = AppDataSource.getRepository(Torneo);

  // Crear un torneo
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

  // Consultar todos los torneos
  app.get("/torneos", async (_request, reply) => {
    const torneos = await torneoRepository.find();

    return reply.code(200).send(torneos);
  });

  // Consultar un torneo por ID
  app.get("/torneos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const torneo = await torneoRepository.findOneBy({
      id: Number(id),
    });

    if (!torneo) {
      return reply.code(404).send({
        message: "Torneo no encontrado",
      });
    }

    return reply.code(200).send(torneo);
  });

  // Actualizar un torneo
  app.patch("/torneos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const torneo = await torneoRepository.findOneBy({
      id: Number(id),
    });

    if (!torneo) {
      return reply.code(404).send({
        message: "Torneo no encontrado",
      });
    }

    const datos = request.body as {
      nombre?: string;
      deporte?: string;
      fechaInicio?: string;
      fechaFin?: string;
      estado?: string;
    };

    torneoRepository.merge(torneo, datos);

    const torneoActualizado = await torneoRepository.save(torneo);

    return reply.code(200).send(torneoActualizado);
  });
}