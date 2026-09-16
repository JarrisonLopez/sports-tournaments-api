import { readFileSync } from "node:fs";

export function resolveDbPassword(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const passwordFile = env.DB_PASSWORD_FILE;

  if (passwordFile) {
    try {
      return readFileSync(passwordFile, "utf8").replace(/\r?\n$/u, "");
    } catch {
      throw new Error("No se pudo leer el archivo indicado por DB_PASSWORD_FILE");
    }
  }

  return env.DB_PASSWORD;
}
