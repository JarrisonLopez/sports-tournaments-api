import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INVALID_TRACK_VALUE,
  resolveRuntimeIdentity,
  UNSET_IDENTITY_VALUE,
} from "../../src/config/runtime-identity";

describe("resolveRuntimeIdentity", () => {
  it("resuelve versión y track explícitos de entorno", () => {
    expect(
      resolveRuntimeIdentity({
        API_VERSION: "3.0.1",
        API_TRACK: "stable",
      }),
    ).toEqual({
      version: "3.0.1",
      track: "stable",
    });

    expect(
      resolveRuntimeIdentity({
        API_VERSION: "4.0.0",
        API_TRACK: "canary",
      }),
    ).toEqual({
      version: "4.0.0",
      track: "canary",
    });
  });

  it("usa unset cuando faltan variables o vienen vacías", () => {
    expect(resolveRuntimeIdentity({})).toEqual({
      version: UNSET_IDENTITY_VALUE,
      track: UNSET_IDENTITY_VALUE,
    });

    expect(
      resolveRuntimeIdentity({
        API_VERSION: "   ",
        API_TRACK: "",
      }),
    ).toEqual({
      version: UNSET_IDENTITY_VALUE,
      track: UNSET_IDENTITY_VALUE,
    });
  });

  it("marca track inválido sin asumir stable ni canary", () => {
    expect(
      resolveRuntimeIdentity({
        API_VERSION: "3.0.1",
        API_TRACK: "production",
      }),
    ).toEqual({
      version: "3.0.1",
      track: INVALID_TRACK_VALUE,
    });

    expect(
      resolveRuntimeIdentity({
        API_VERSION: "3.0.1",
        API_TRACK: "Stable",
      }).track,
    ).toBe(INVALID_TRACK_VALUE);
  });

  it("no toma la versión de package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };

    expect(packageJson.version).toBe("1.0.0");

    const fromEnv = resolveRuntimeIdentity({
      API_VERSION: "3.0.1",
      API_TRACK: "stable",
    });

    expect(fromEnv.version).toBe("3.0.1");
    expect(fromEnv.version).not.toBe(packageJson.version);

    const absent = resolveRuntimeIdentity({});

    expect(absent.version).toBe(UNSET_IDENTITY_VALUE);
    expect(absent.version).not.toBe(packageJson.version);
  });
});
