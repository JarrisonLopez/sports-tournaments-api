import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";

import { Torneo } from "../entities/Torneo";
import { Cancha } from "../entities/Cancha";
import { Jugador } from "../entities/Jugador";
import { resolveDbPassword } from "./db-password";

const cloudSqlConnectionName = process.env.CLOUD_SQL_CONNECTION_NAME;

export const AppDataSource = new DataSource({
  type: "mysql",

  ...(cloudSqlConnectionName
    ? {
        extra: {
          socketPath: `/cloudsql/${cloudSqlConnectionName}`,
        },
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
      }),

  username: process.env.DB_USER,
  password: resolveDbPassword(),
  database: process.env.DB_NAME,

  entities: [Torneo, Cancha, Jugador],

  synchronize: true,
  logging: false,
});
