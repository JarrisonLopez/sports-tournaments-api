import { describe, expect, it } from "vitest";

import {
  isFaultInjectionArmed,
  MIN_FAULT_TOKEN_LENGTH,
  normalizeFaultToken,
  resolveFaultInjectionConfig,
  secureTokenEquals,
} from "../../src/config/fault-injection";

const VALID_TOKEN = "a".repeat(MIN_FAULT_TOKEN_LENGTH);

describe("resolveFaultInjectionConfig", () => {
  it("queda deshabilitado por defecto sin leer tokens cortos", () => {
    expect(resolveFaultInjectionConfig({})).toEqual({
      enabled: false,
      token: null,
    });

    expect(
      resolveFaultInjectionConfig({
        FAULT_INJECTION_ENABLED: "false",
        FAULT_INJECTION_TOKEN: VALID_TOKEN,
      }),
    ).toEqual({
      enabled: false,
      token: VALID_TOKEN,
    });
  });

  it("solo habilita con FAULT_INJECTION_ENABLED=true exacto", () => {
    expect(
      resolveFaultInjectionConfig({
        FAULT_INJECTION_ENABLED: "TRUE",
        FAULT_INJECTION_TOKEN: VALID_TOKEN,
      }).enabled,
    ).toBe(false);

    expect(
      resolveFaultInjectionConfig({
        FAULT_INJECTION_ENABLED: "true",
        FAULT_INJECTION_TOKEN: VALID_TOKEN,
      }),
    ).toEqual({
      enabled: true,
      token: VALID_TOKEN,
    });
  });

  it("rechaza token vacío, corto o solo espacios", () => {
    expect(
      resolveFaultInjectionConfig({
        FAULT_INJECTION_ENABLED: "true",
        FAULT_INJECTION_TOKEN: "",
      }).token,
    ).toBeNull();

    expect(
      resolveFaultInjectionConfig({
        FAULT_INJECTION_ENABLED: "true",
        FAULT_INJECTION_TOKEN: "   ",
      }).token,
    ).toBeNull();

    expect(
      resolveFaultInjectionConfig({
        FAULT_INJECTION_ENABLED: "true",
        FAULT_INJECTION_TOKEN: "a".repeat(MIN_FAULT_TOKEN_LENGTH - 1),
      }).token,
    ).toBeNull();

    expect(normalizeFaultToken(undefined)).toBeNull();
  });
});

describe("isFaultInjectionArmed", () => {
  const armedConfig = { enabled: true, token: VALID_TOKEN };

  it("requiere track canary, enable y token válido", () => {
    expect(
      isFaultInjectionArmed({ version: "4.0.0", track: "canary" }, armedConfig),
    ).toBe(true);

    expect(
      isFaultInjectionArmed({ version: "3.0.1", track: "stable" }, armedConfig),
    ).toBe(false);

    expect(
      isFaultInjectionArmed(
        { version: "4.0.0", track: "unset" },
        armedConfig,
      ),
    ).toBe(false);

    expect(
      isFaultInjectionArmed(
        { version: "4.0.0", track: "invalid" },
        armedConfig,
      ),
    ).toBe(false);

    expect(
      isFaultInjectionArmed(
        { version: "4.0.0", track: "canary" },
        { enabled: false, token: VALID_TOKEN },
      ),
    ).toBe(false);

    expect(
      isFaultInjectionArmed(
        { version: "4.0.0", track: "canary" },
        { enabled: true, token: null },
      ),
    ).toBe(false);
  });
});

describe("secureTokenEquals", () => {
  it("acepta coincidencias y rechaza diferencias sin lanzar", () => {
    expect(secureTokenEquals(VALID_TOKEN, VALID_TOKEN)).toBe(true);
    expect(secureTokenEquals(VALID_TOKEN, `${VALID_TOKEN}x`)).toBe(false);
    expect(secureTokenEquals("short", VALID_TOKEN)).toBe(false);
  });
});
