import { beforeEach, describe, expect, it, vi } from "vitest";

const builders: ReturnType<typeof createBuilder>[] = [];

function createBuilder() {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder = {
    calls,
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return builder;
    },
    addSelect(...args: unknown[]) {
      calls.push({ method: "addSelect", args });
      return builder;
    },
    groupBy(...args: unknown[]) {
      calls.push({ method: "groupBy", args });
      return builder;
    },
    orderBy(...args: unknown[]) {
      calls.push({ method: "orderBy", args });
      return builder;
    },
    addOrderBy(...args: unknown[]) {
      calls.push({ method: "addOrderBy", args });
      return builder;
    },
    getRawOne: vi.fn(),
    getRawMany: vi.fn(),
  };

  return builder;
}

const queryRunner = {
  isTransactionActive: true,
  manager: {
    createQueryBuilder: vi.fn(),
  },
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
};

vi.mock("../../src/config/database", () => ({
  AppDataSource: {
    createQueryRunner: () => queryRunner,
  },
}));

import { consultarEstadisticasTorneos } from "../../src/services/torneo.service";

describe("consultarEstadisticasTorneos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    builders.length = 0;
    queryRunner.isTransactionActive = true;
    queryRunner.manager.createQueryBuilder.mockImplementation(() => {
      const builder = createBuilder();
      builders.push(builder);
      return builder;
    });
  });

  it("agrega total, deporte y estado en un snapshot REPEATABLE READ", async () => {
    const total = createBuilder();
    const porDeporte = createBuilder();
    const porEstado = createBuilder();
    builders.push(total, porDeporte, porEstado);
    queryRunner.manager.createQueryBuilder
      .mockReset()
      .mockReturnValueOnce(total)
      .mockReturnValueOnce(porDeporte)
      .mockReturnValueOnce(porEstado);
    total.getRawOne.mockResolvedValue({ total: "3" });
    porDeporte.getRawMany.mockResolvedValue([
      { deporte: "Futbol", cantidad: "2" },
      { deporte: "Tenis", cantidad: "1" },
    ]);
    porEstado.getRawMany.mockResolvedValue([
      { estado: "PROGRAMADO", cantidad: "3" },
    ]);

    const resultado = await consultarEstadisticasTorneos();

    expect(queryRunner.startTransaction).toHaveBeenCalledWith("REPEATABLE READ");
    expect(queryRunner.manager.createQueryBuilder).toHaveBeenCalledTimes(3);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(total.calls).toEqual([
      { method: "select", args: ["COUNT(*)", "total"] },
    ]);
    expect(porDeporte.calls).toEqual([
      { method: "select", args: ["torneo.deporte", "deporte"] },
      { method: "addSelect", args: ["COUNT(*)", "cantidad"] },
      { method: "groupBy", args: ["torneo.deporte"] },
      { method: "orderBy", args: ["cantidad", "DESC"] },
      { method: "addOrderBy", args: ["torneo.deporte", "ASC"] },
    ]);
    expect(porEstado.calls).toEqual([
      { method: "select", args: ["torneo.estado", "estado"] },
      { method: "addSelect", args: ["COUNT(*)", "cantidad"] },
      { method: "groupBy", args: ["torneo.estado"] },
      { method: "orderBy", args: ["cantidad", "DESC"] },
      { method: "addOrderBy", args: ["torneo.estado", "ASC"] },
    ]);
    expect(resultado).toEqual({
      total: "3",
      porDeporte: [
        { deporte: "Futbol", cantidad: "2" },
        { deporte: "Tenis", cantidad: "1" },
      ],
      porEstado: [{ estado: "PROGRAMADO", cantidad: "3" }],
    });
  });

  it("revierte la transacción si una consulta falla", async () => {
    const total = createBuilder();
    queryRunner.manager.createQueryBuilder.mockReset().mockReturnValue(total);
    total.getRawOne.mockRejectedValue(new Error("sql down"));

    await expect(consultarEstadisticasTorneos()).rejects.toThrow("sql down");
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it("libera el QueryRunner si no llega a abrir la transacción", async () => {
    queryRunner.isTransactionActive = false;
    queryRunner.connect.mockRejectedValueOnce(new Error("pool closed"));

    await expect(consultarEstadisticasTorneos()).rejects.toThrow("pool closed");
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(queryRunner.manager.createQueryBuilder).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
