import { beforeEach, describe, expect, it, vi } from "vitest";

const queryBuilder = {
  where: vi.fn(),
  orderBy: vi.fn(),
  addOrderBy: vi.fn(),
  take: vi.fn(),
  getMany: vi.fn(),
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
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.getMany.mockResolvedValue([]);
  });

  it("filtra, ordena y limita en el query builder sin traer la tabla completa", async () => {
    await buscarProximos({
      fechaInicioDesde: "2026-11-05",
      limite: 20,
    });

    expect(queryBuilder.where).toHaveBeenCalledWith(
      "torneo.fechaInicio >= :fechaInicioDesde",
      { fechaInicioDesde: "2026-11-05" },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      "torneo.fechaInicio",
      "ASC",
    );
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith("torneo.id", "ASC");
    expect(queryBuilder.take).toHaveBeenCalledWith(20);
    expect(queryBuilder.getMany).toHaveBeenCalledTimes(1);
  });
});
