import { describe, expect, it, vi } from "vitest";

import {
  CineConfigError,
  CineRequestError,
  obtenerPelicula,
} from "../../src/clients/cine.client";

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

  it("falla si CINE_API_URL no está configurada", async () => {
    await expect(
      obtenerPelicula(1, "t-cfg", {
        fetch: vi.fn() as unknown as typeof fetch,
        env: { CINE_API_URL: "   " },
      }),
    ).rejects.toBeInstanceOf(CineConfigError);
  });

  it("propaga error HTTP del upstream Cine", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({}),
    }));

    await expect(
      obtenerPelicula(9, "t-err", {
        fetch: fetchMock as unknown as typeof fetch,
        env: { CINE_API_URL: "http://cine.example/" },
      }),
    ).rejects.toMatchObject({
      name: "CineRequestError",
      status: 503,
    });
  });

  it("rechaza payload cine inválido o incompleto", async () => {
    const invalidBody = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => null,
    }));
    await expect(
      obtenerPelicula(1, "t-bad-body", {
        fetch: invalidBody as unknown as typeof fetch,
        env: { CINE_API_URL: "http://cine.example" },
      }),
    ).rejects.toBeInstanceOf(CineRequestError);

    const invalidFields = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "x", duracion: "y", nombre: "n" }),
    }));
    await expect(
      obtenerPelicula(1, "t-bad-fields", {
        fetch: invalidFields as unknown as typeof fetch,
        env: { CINE_API_URL: "http://cine.example" },
      }),
    ).rejects.toBeInstanceOf(CineRequestError);
  });

  it("ignora origen vacío en el envelope GCP", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        origen: "",
        pelicula: {
          id: 7,
          nombre: "Sin origen",
          duracion: 100,
          genero: "Drama",
          descripcion: "d",
        },
      }),
    }));

    const p = await obtenerPelicula(7, "t-empty-origen", {
      fetch: fetchMock as unknown as typeof fetch,
      env: { CINE_API_URL: "http://cine.example" },
    });
    expect(p.id).toBe(7);
    expect(p.origen).toBeUndefined();
  });
});
