import { EntityManager } from "typeorm";

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

export type FilaConteo = {
  total: unknown;
};

export type FilaGrupoDeporte = {
  deporte: string | null;
  cantidad: unknown;
};

export type FilaGrupoEstado = {
  estado: string | null;
  cantidad: unknown;
};

export type EstadisticasTorneosRaw = {
  total: unknown;
  porDeporte: FilaGrupoDeporte[];
  porEstado: FilaGrupoEstado[];
};

/**
 * Tres agregados en la misma transacción REPEATABLE READ.
 * Así las tres lecturas ven el mismo snapshot aunque haya escrituras concurrentes.
 */
export async function consultarEstadisticasTorneos(): Promise<EstadisticasTorneosRaw> {
  const queryRunner = AppDataSource.createQueryRunner();

  try {
    await queryRunner.connect();
    await queryRunner.startTransaction("REPEATABLE READ");

    const total = await contarTorneos(queryRunner.manager);
    const porDeporte = await agruparPorDeporte(queryRunner.manager);
    const porEstado = await agruparPorEstado(queryRunner.manager);
    await queryRunner.commitTransaction();

    return { total, porDeporte, porEstado };
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }

    throw error;
  } finally {
    await queryRunner.release();
  }
}

export async function contarTorneos(manager: EntityManager): Promise<unknown> {
  const fila = await manager
    .createQueryBuilder(Torneo, "torneo")
    .select("COUNT(*)", "total")
    .getRawOne<FilaConteo>();

  if (!fila || !Object.prototype.hasOwnProperty.call(fila, "total")) {
    throw new Error("La consulta de total no devolvió el alias total");
  }

  return fila.total;
}

export async function agruparPorDeporte(
  manager: EntityManager,
): Promise<FilaGrupoDeporte[]> {
  const filas = await manager
    .createQueryBuilder(Torneo, "torneo")
    .select("torneo.deporte", "deporte")
    .addSelect("COUNT(*)", "cantidad")
    .groupBy("torneo.deporte")
    .orderBy("cantidad", "DESC")
    .addOrderBy("torneo.deporte", "ASC")
    .getRawMany<FilaGrupoDeporte>();

  return filas.map((fila) => {
    if (!Object.prototype.hasOwnProperty.call(fila, "deporte")) {
      throw new Error("La consulta por deporte no devolvió el alias deporte");
    }

    if (!Object.prototype.hasOwnProperty.call(fila, "cantidad")) {
      throw new Error("La consulta por deporte no devolvió el alias cantidad");
    }

    return {
      deporte: fila.deporte,
      cantidad: fila.cantidad,
    };
  });
}

export async function agruparPorEstado(
  manager: EntityManager,
): Promise<FilaGrupoEstado[]> {
  const filas = await manager
    .createQueryBuilder(Torneo, "torneo")
    .select("torneo.estado", "estado")
    .addSelect("COUNT(*)", "cantidad")
    .groupBy("torneo.estado")
    .orderBy("cantidad", "DESC")
    .addOrderBy("torneo.estado", "ASC")
    .getRawMany<FilaGrupoEstado>();

  return filas.map((fila) => {
    if (!Object.prototype.hasOwnProperty.call(fila, "estado")) {
      throw new Error("La consulta por estado no devolvió el alias estado");
    }

    if (!Object.prototype.hasOwnProperty.call(fila, "cantidad")) {
      throw new Error("La consulta por estado no devolvió el alias cantidad");
    }

    return {
      estado: fila.estado,
      cantidad: fila.cantidad,
    };
  });
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
