import { AppDataSource } from "../config/database";
import { Torneo } from "../entities/Torneo";

function getTorneoRepository() {
  return AppDataSource.getRepository(Torneo);
}

export async function crear(datos: {
  nombre: string;
  deporte: string;
  fechaInicio: string;
  fechaFin: string;
  estado?: string;
}) {
  const torneoRepository = getTorneoRepository();

  const torneo = torneoRepository.create(datos);

  return torneoRepository.save(torneo);
}

export async function listar(filtros: {
  deporte?: string;
  estado?: string;
}) {
  const torneoRepository = getTorneoRepository();

  return torneoRepository.find({
    where: {
      ...(filtros.deporte && { deporte: filtros.deporte }),
      ...(filtros.estado && { estado: filtros.estado }),
    },
  });
}

export async function buscarPorId(id: number) {
  const torneoRepository = getTorneoRepository();

  return torneoRepository.findOneBy({
    id,
  });
}

export async function actualizar(
  id: number,
  datos: {
    nombre?: string;
    deporte?: string;
    fechaInicio?: string;
    fechaFin?: string;
    estado?: string;
  },
) {
  const torneoRepository = getTorneoRepository();

  const torneo = await torneoRepository.findOneBy({
    id,
  });

  if (!torneo) {
    return null;
  }

  torneoRepository.merge(torneo, datos);

  return torneoRepository.save(torneo);
}

export async function eliminar(id: number) {
  const torneoRepository = getTorneoRepository();

  const torneo = await torneoRepository.findOneBy({
    id,
  });

  if (!torneo) {
    return null;
  }

  await torneoRepository.remove(torneo);

  return torneo;
}
