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

export type FilaTorneoProximo = {
  id: number | string;
  nombre: string;
  deporte: string;
  estado: string;
  fechaInicio: string;
  fechaFin: string;
};

/**
 * Torneos con fechaInicio (DATE) mayor o igual a una fecha de calendario.
 * DATE_FORMAT devuelve texto YYYY-MM-DD para que mysql2 no construya un Date.
 * El filtro, el orden y el límite se resuelven en MySQL.
 */
export async function buscarProximos(filtros: {
  fechaInicioDesde: string;
  limite: number;
}): Promise<FilaTorneoProximo[]> {
  const torneoRepository = getTorneoRepository();

  return torneoRepository
    .createQueryBuilder("torneo")
    .select("torneo.id", "id")
    .addSelect("torneo.nombre", "nombre")
    .addSelect("torneo.deporte", "deporte")
    .addSelect("torneo.estado", "estado")
    .addSelect("DATE_FORMAT(torneo.fechaInicio, '%Y-%m-%d')", "fechaInicio")
    .addSelect("DATE_FORMAT(torneo.fechaFin, '%Y-%m-%d')", "fechaFin")
    .where("torneo.fechaInicio >= :fechaInicioDesde", {
      fechaInicioDesde: filtros.fechaInicioDesde,
    })
    .orderBy("torneo.fechaInicio", "ASC")
    .addOrderBy("torneo.id", "ASC")
    .limit(filtros.limite)
    .getRawMany<FilaTorneoProximo>();
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
