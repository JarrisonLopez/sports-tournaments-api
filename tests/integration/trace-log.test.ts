import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";

type LogEntry = Record<string, unknown>;

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

describe("Logs correlacionados de Sports API", () => {
  it("conserva el x-trace-id recibido en los logs posteriores y en request completed", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/flujo/abc/1/2",
      headers: {
        "x-trace-id": "trace-abc",
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers["x-trace-id"]).toBe("trace-abc");

    const incoming = logs.entries.filter(
      (entry) => entry.msg === "incoming request",
    );
    const petition = logs.entries.filter(
      (entry) => entry.msg === "Petición API V2",
    );
    const completed = logs.entries.filter(
      (entry) => entry.msg === "request completed",
    );

    expect(incoming).toHaveLength(1);
    expect(incoming[0]).not.toHaveProperty("traceId");
    expect(incoming[0].reqId).toEqual(expect.any(String));

    expect(petition).toHaveLength(1);
    expect(petition[0].traceId).toBe("trace-abc");
    expect(petition[0].reqId).toBe(incoming[0].reqId);
    expect(petition[0].reqId).not.toBe("trace-abc");

    expect(completed).toHaveLength(1);
    expect(completed[0].traceId).toBe("trace-abc");
    expect(completed[0].reqId).toBe(incoming[0].reqId);

    await app.close();
  });

  it("usa en los logs el trace id que Sports genera cuando el header no llega", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/flujo/abc/1/2",
    });

    const generated = respuesta.headers["x-trace-id"];

    expect(respuesta.statusCode).toBe(400);
    expect(typeof generated).toBe("string");
    expect(generated).not.toBe("");

    const completed = logs.entries.find(
      (entry) => entry.msg === "request completed",
    );
    const petition = logs.entries.find(
      (entry) => entry.msg === "Petición API V2",
    );

    expect(petition?.traceId).toBe(generated);
    expect(completed?.traceId).toBe(generated);
    expect(completed?.reqId).toEqual(expect.any(String));
    expect(completed?.reqId).not.toBe(generated);

    await app.close();
  });

  it("correlaciona el log de un error 5xx sin cambiar la respuesta HTTP", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/api/v2/flujo/1/2/3",
      headers: {
        "x-trace-id": "trace-error",
      },
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.headers["x-trace-id"]).toBe("trace-error");
    expect(respuesta.json()).toMatchObject({
      statusCode: 500,
    });

    const errorLogs = logs.entries.filter(
      (entry) => entry.level === 50 && entry.traceId === "trace-error",
    );

    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs.some((entry) => entry.err !== undefined)).toBe(true);
    expect(
      logs.entries.find((entry) => entry.msg === "request completed")?.traceId,
    ).toBe("trace-error");

    await app.close();
  });

  it("no mezcla el traceId de dos peticiones concurrentes", async () => {
    const logs = captureLogs();
    const app = buildApp({
      logger: {
        level: "info",
        stream: logs.stream,
      },
    });

    const [primera, segunda] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v2/flujo/abc/1/2",
        headers: {
          "x-trace-id": "trace-a",
        },
      }),
      app.inject({
        method: "GET",
        url: "/api/v2/flujo/xyz/4/5",
        headers: {
          "x-trace-id": "trace-b",
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

    await app.close();
  });
});
