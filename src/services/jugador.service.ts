import { AppDataSource } from "../config/database";
import { Jugador } from "../entities/Jugador";

function getJugadorRepository() {
  return AppDataSource.getRepository(Jugador);
}

export async function crear(datos: {
  nombre: string;
  documento: string;
  fechaNacimiento: string;
  posicion: string;
}) {
  const jugadorRepository = getJugadorRepository();

  const jugador = jugadorRepository.create(datos);

  return jugadorRepository.save(jugador);
}

export async function listar(filtros: {
  nombre?: string;
  posicion?: string;
}) {
  const jugadorRepository = getJugadorRepository();

  return jugadorRepository.find({
    where: {
      ...(filtros.nombre && { nombre: filtros.nombre }),
      ...(filtros.posicion && { posicion: filtros.posicion }),
    },
  });
}

export async function buscarPorId(id: number) {
  const jugadorRepository = getJugadorRepository();

  return jugadorRepository.findOneBy({
    id,
  });
}

export async function actualizar(
  id: number,
  datos: {
    nombre?: string;
    documento?: string;
    fechaNacimiento?: string;
    posicion?: string;
  },
) {
  const jugadorRepository = getJugadorRepository();

  const jugador = await jugadorRepository.findOneBy({
    id,
  });

  if (!jugador) {
    return null;
  }

  jugadorRepository.merge(jugador, datos);

  return jugadorRepository.save(jugador);
}

export async function eliminar(id: number) {
  const jugadorRepository = getJugadorRepository();

  const jugador = await jugadorRepository.findOneBy({
    id,
  });

  if (!jugador) {
    return null;
  }

  await jugadorRepository.remove(jugador);

  return jugador;
}
