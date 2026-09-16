import { AppDataSource } from "../config/database";

export async function isDatabaseReady(): Promise<boolean> {
  if (!AppDataSource.isInitialized) {
    return false;
  }

  try {
    await AppDataSource.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
