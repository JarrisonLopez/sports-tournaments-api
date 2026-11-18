import { beforeEach, describe, expect, it, vi } from "vitest";

const queryBuilder = {
  select: vi.fn(),
  addSelect: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  addOrderBy: vi.fn(),
  limit: vi.fn(),
  getRawMany: vi.fn(),
};

vi.mock("../../src/config/database", () => ({
  AppDataSource: {
    getRepository: () => ({
      createQueryBuilder: () => queryBuilder,
    }),
  },
}));

import { buscarProximos } from "../../src/services/torneo.service";

describe("buscarProximos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.addSelect.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
    queryBuilder.limit.mockReturnValue(queryBuilder);
    queryBuilder.getRawMany.mockResolvedValue([]);
  });

  it("proyecta DATE como texto y filtra, ordena y limita en SQL", async () => {
    await buscarProximos({
      fechaInicioDesde: "2026-11-05",
      limite: 20,
    });

    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      "DATE_FORMAT(torneo.fechaInicio, '%Y-%m-%d')",
      "fechaInicio",
    );
    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      "DATE_FORMAT(torneo.fechaFin, '%Y-%m-%d')",
      "fechaFin",
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "torneo.fechaInicio >= :fechaInicioDesde",
      { fechaInicioDesde: "2026-11-05" },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      "torneo.fechaInicio",
      "ASC",
    );
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith("torneo.id", "ASC");
    expect(queryBuilder.limit).toHaveBeenCalledWith(20);
    expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
  });
});
