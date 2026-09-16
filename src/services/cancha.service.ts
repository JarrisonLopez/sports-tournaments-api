import { AppDataSource } from "../config/database";
import { Cancha } from "../entities/Cancha";

function getCanchaRepository() {
  return AppDataSource.getRepository(Cancha);
}

export async function crear(datos: {
  nombre: string;
  ubicacion: string;
  tipoSuperficie: string;
  disponible?: boolean;
}) {
  const canchaRepository = getCanchaRepository();

  const cancha = canchaRepository.create(datos);

  return canchaRepository.save(cancha);
}

export async function listar(filtros: {
  tipoSuperficie?: string;
  disponible?: string;
}) {
  const canchaRepository = getCanchaRepository();

  return canchaRepository.find({
    where: {
      ...(filtros.tipoSuperficie && { tipoSuperficie: filtros.tipoSuperficie }),
      ...(filtros.disponible !== undefined && {
        disponible: filtros.disponible === "true",
      }),
    },
  });
}

export async function buscarPorId(id: number) {
  const canchaRepository = getCanchaRepository();

  return canchaRepository.findOneBy({
    id,
  });
}

export async function actualizar(
  id: number,
  datos: {
    nombre?: string;
    ubicacion?: string;
    tipoSuperficie?: string;
    disponible?: boolean;
  },
) {
  const canchaRepository = getCanchaRepository();

  const cancha = await canchaRepository.findOneBy({
    id,
  });

  if (!cancha) {
    return null;
  }

  canchaRepository.merge(cancha, datos);

  return canchaRepository.save(cancha);
}

export async function eliminar(id: number) {
  const canchaRepository = getCanchaRepository();

  const cancha = await canchaRepository.findOneBy({
    id,
  });

  if (!cancha) {
    return null;
  }

  await canchaRepository.remove(cancha);

  return cancha;
}
