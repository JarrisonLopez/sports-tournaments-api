import { buildApp } from "./app";
import { AppDataSource } from "./config/database";

const app = buildApp();

const start = async () => {
  try {
    await AppDataSource.initialize();

    app.log.info("Base de datos conectada");

    await app.listen({
      port: Number(process.env.PORT) || 3000,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();