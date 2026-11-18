import { describe, expect, it, vi } from "vitest";

import { obtenerPelicula } from "../../src/clients/cine.client";

describe("cine client contract (GCP envelope)", () => {
  it("unwraps { pelicula, origen, traceId } from Cine GCP", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        origen: "database",
        traceId: "t-1",
        pelicula: {
          id: 1,
          nombre: "Pelicula Prueba",
          duracion: 120,
          genero: "Accion",
          descripcion: "desc",
        },
      }),
    }));

    const p = await obtenerPelicula(1, "t-1", {
      fetch: fetchMock as unknown as typeof fetch,
      env: { CINE_API_URL: "http://cine.example" },
    });

    expect(p.id).toBe(1);
    expect(p.nombre).toBe("Pelicula Prueba");
    expect(p.duracion).toBe(120);
    expect(p.origen).toBe("database");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("accepts flat pelicula JSON (lab mocks)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 2,
        nombre: "Flat",
        duracion: 90,
        genero: "Drama",
        descripcion: "d",
      }),
    }));

    const p = await obtenerPelicula(2, "t-2", {
      fetch: fetchMock as unknown as typeof fetch,
      env: { CINE_API_URL: "http://cine.example" },
    });

    expect(p.id).toBe(2);
    expect(p.nombre).toBe("Flat");
  });
});
