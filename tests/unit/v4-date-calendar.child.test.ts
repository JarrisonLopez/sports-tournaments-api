import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/torneo.service", () => ({
  buscarProximos: vi.fn(),
}));

import { buscarProximos } from "../../src/services/torneo.service";
import { listarProximos } from "../../src/services/v4-torneo-proximos.service";

const { DateUtils } = createRequire(import.meta.url)(
  "typeorm/util/DateUtils.js",
) as {
  DateUtils: {
    mixedDateToDateString: (
      value: Date,
      options: { utc: boolean },
    ) => string;
  };
};

const zone = process.env.TZ ?? "unset";

describe(`calendario DATE en ${zone}`, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TypeORM con utc false conserva el día local y el servicio no usa getUTC", async () => {
    const medianocheLocal = new Date(2026, 10, 5, 0, 0, 0, 0);
    const hidratada = DateUtils.mixedDateToDateString(medianocheLocal, {
      utc: false,
    });
    const conUtc = DateUtils.mixedDateToDateString(medianocheLocal, {
      utc: true,
    });

    expect(hidratada).toBe("2026-11-05");

    vi.mocked(buscarProximos).mockResolvedValue([
      {
        id: 5,
        nombre: "Torneo 5",
        deporte: "Futbol",
        estado: "PROGRAMADO",
        fechaInicio: hidratada,
        fechaFin: "2026-11-12 00:00:00",
      },
    ] as never);

    const resultado = await listarProximos({
      ahora: new Date("2026-11-05T15:00:00.000Z"),
      limite: 20,
    });

    expect(resultado[0]?.fechaInicio).toBe("2026-11-05");
    expect(resultado[0]?.fechaFin).toBe("2026-11-12");
    expect(resultado[0]?.fechaInicio).not.toBe(
      conUtc === "2026-11-05" ? "2026-11-04" : conUtc,
    );
  });
});
