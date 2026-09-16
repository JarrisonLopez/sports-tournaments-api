import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveDbPassword } from "../../src/config/db-password";

describe("resolveDbPassword", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("usa el contenido del archivo cuando DB_PASSWORD_FILE está definido", () => {
    tempDir = mkdtempSync(join(tmpdir(), "db-password-"));
    const passwordFile = join(tempDir, "db-password");
    writeFileSync(passwordFile, "from-file\n", "utf8");

    expect(
      resolveDbPassword({
        DB_PASSWORD_FILE: passwordFile,
        DB_PASSWORD: "from-env",
      }),
    ).toBe("from-file");
  });

  it("usa DB_PASSWORD cuando DB_PASSWORD_FILE no está definido", () => {
    expect(
      resolveDbPassword({
        DB_PASSWORD: "from-env",
      }),
    ).toBe("from-env");
  });

  it("falla si DB_PASSWORD_FILE apunta a un archivo inexistente", () => {
    tempDir = mkdtempSync(join(tmpdir(), "db-password-"));

    const env = {
      DB_PASSWORD_FILE: join(tempDir, "missing"),
      DB_PASSWORD: "from-env",
    };

    expect(() => resolveDbPassword(env)).toThrow(
      "No se pudo leer el archivo indicado por DB_PASSWORD_FILE",
    );

    try {
      resolveDbPassword(env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("from-env");
    }
  });
});
