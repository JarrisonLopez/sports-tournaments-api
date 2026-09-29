import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const save = vi.fn();
  const download = vi.fn();
  const file = vi.fn(() => ({ save, download }));
  const bucket = vi.fn(() => ({ file }));

  return { save, download, file, bucket };
});

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class {
      bucket(bucketName: string) {
        return mocks.bucket(bucketName);
      }
    },
  };
});

import { buildApp } from "../../src/app";

type LogEntry = Record<string, unknown>;

const artifact = {
  traceId: "trace-1",
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

function captureLogs(): { stream: Writable; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  let buffered = "";

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") {
          continue;
        }

        entries.push(JSON.parse(line) as LogEntry);
      }

      callback();
    },
  });

  return { stream, entries };
}

function tracesByRequest(entries: LogEntry[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (typeof entry.reqId !== "string" || typeof entry.traceId !== "string") {
      continue;
    }

    const traces = grouped.get(entry.reqId) ?? new Set<string>();
    traces.add(entry.traceId);
    grouped.set(entry.reqId, traces);
  }

  return grouped;
}

describe("Logs correlacionados de Object Storage", () => {
  beforeEach(() => {
    mocks.save.mockReset();
    mocks.download.mockReset();
    mocks.file.mockReset();
    mocks.bucket.mockReset();
    mocks.file.mockImplementation(() => ({
      save: mocks.save,
      download: mocks.download,
    }));
    mocks.bucket.mockImplementation(() => ({
      file: mocks.file,
    }));
    mocks.save.mockResolvedValue(undefined);
    process.env.GCS_BUCKET_NAME = "test-bucket";
  });

  it("incluye el trace recibido en los logs posteriores de un POST válido", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.headers["x-trace-id"]).toBe("trace-1");

    const incoming = logs.entries.filter(
      (entry) => entry.msg === "incoming request",
    );
    const completed = logs.entries.filter(
      (entry) => entry.msg === "request completed",
    );

    expect(incoming).toHaveLength(1);
    expect(incoming[0]).not.toHaveProperty("traceId");
    expect(incoming[0].reqId).toEqual(expect.any(String));
    expect(completed).toHaveLength(1);
    expect(completed[0].traceId).toBe("trace-1");
    expect(completed[0].reqId).toBe(incoming[0].reqId);
    expect(completed[0].reqId).not.toBe("trace-1");
    expectNoOtelFields(logs.entries);

    await app.close();
  });

  it("correlaciona el error de almacenamiento con el trace recibido", async () => {
    delete process.env.GCS_BUCKET_NAME;

    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "trace-1",
      },
      payload: artifact,
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json()).toEqual({
      message: "Error de almacenamiento",
    });

    const storageError = logs.entries.find(
      (entry) => entry.msg === "Error de almacenamiento",
    );

    expect(storageError?.traceId).toBe("trace-1");
    expect(storageError?.reqId).toEqual(expect.any(String));
    expect(storageError?.err).toBeDefined();
    expect(
      logs.entries.find((entry) => entry.msg === "request completed")?.traceId,
    ).toBe("trace-1");
    expectNoOtelFields(logs.entries);

    await app.close();
  });

  it("no mezcla el traceId de dos peticiones distintas", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const [primera, segunda] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v2/artifacts",
        headers: {
          "x-trace-id": "trace-a",
        },
        payload: {
          ...artifact,
          traceId: "trace-a",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/v2/artifacts",
        headers: {
          "x-trace-id": "trace-b",
        },
        payload: {
          ...artifact,
          traceId: "trace-b",
        },
      }),
    ]);

    expect(primera.headers["x-trace-id"]).toBe("trace-a");
    expect(segunda.headers["x-trace-id"]).toBe("trace-b");

    const grouped = tracesByRequest(logs.entries);

    expect(grouped.size).toBe(2);

    for (const [reqId, traces] of grouped) {
      expect(traces.size).toBe(1);
      expect(reqId).not.toBe([...traces][0]);
    }

    const traces = [...grouped.values()].map((value) => [...value][0]);
    expect(traces).toContain("trace-a");
    expect(traces).toContain("trace-b");
    expectNoOtelFields(logs.entries);

    await app.close();
  });

  it("no genera traceId cuando el header falta o es inválido", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const ausente = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      payload: artifact,
    });
    const invalido = await app.inject({
      method: "POST",
      url: "/api/v2/artifacts",
      headers: {
        "x-trace-id": "",
      },
      payload: artifact,
    });

    expect(ausente.statusCode).toBe(400);
    expect(invalido.statusCode).toBe(400);
    expect(ausente.headers["x-trace-id"]).toBeUndefined();
    expect(invalido.headers["x-trace-id"]).toBeUndefined();
    expect(logs.entries.some((entry) => entry.traceId !== undefined)).toBe(
      false,
    );
    expect(logs.entries.some((entry) => entry.otelTraceId !== undefined)).toBe(
      false,
    );
    expect(logs.entries.some((entry) => entry.otelSpanId !== undefined)).toBe(
      false,
    );
    expect(logs.entries.some((entry) => typeof entry.reqId === "string")).toBe(
      true,
    );

    await app.close();
  });
});

function expectNoOtelFields(entries: LogEntry[]): void {
  const traced = entries.filter((entry) => typeof entry.traceId === "string");

  expect(traced.length).toBeGreaterThan(0);

  for (const entry of traced) {
    expect(entry).not.toHaveProperty("otelTraceId");
    expect(entry).not.toHaveProperty("otelSpanId");
  }
}