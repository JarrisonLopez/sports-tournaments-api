import { assertStartupSchema } from "./schema/startup-schema";

export type StartupDatabase = {
  initialize(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  destroy(): Promise<void>;
  isInitialized: boolean;
};

export async function bootApplication(
  dataSource: StartupDatabase,
  listen: () => Promise<void>,
): Promise<void> {
  try {
    await dataSource.initialize();
    await assertStartupSchema((sql) => dataSource.query(sql));
    await listen();
  } catch (error) {
    try {
      await destroyInitialized(dataSource);
    } catch {
      // Conserva el error original de arranque.
    }

    throw error;
  }
}

async function destroyInitialized(dataSource: StartupDatabase): Promise<void> {
  if (!dataSource.isInitialized) {
    return;
  }

  await dataSource.destroy();
}
