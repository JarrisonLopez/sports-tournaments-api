import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";

import { Torneo } from "../entities/Torneo";
import { Cancha } from "../entities/Cancha";
import { Jugador } from "../entities/Jugador";

export const AppDataSource = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  entities: [Torneo, Cancha, Jugador],

  synchronize: true,
  logging: false,
});