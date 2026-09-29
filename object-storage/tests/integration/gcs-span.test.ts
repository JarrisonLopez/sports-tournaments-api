import { afterEach, describe, expect, it, vi } from "vitest";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

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

import { shutdownTracing, startTracing } from "../../src/instrumentation";

const BUSINESS_TRACE_ID = "trace-negocio";

const artifact = {
  traceId: BUSINESS_TRACE_ID,
  torneo: { id: 1 },
  habitacion: { id: 2 },
  pelicula: { id: 3 },
};

async function flushSpans(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };

  await provider.getDelegate?.()?.forceFlush?.();
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("El servidor no expuso un puerto TCP");
  }

  return `http://127.0.0.1:${address.port}`;
}

function spansNamed(exporter: InMemorySpanExporter, name: string): ReadableSpan[] {
  return exporter.getFinishedSpans().filter((span) => span.name === name);
}

describe("Spans manuales de Google Cloud Storage", () => {
  const originalBucket = process.env.GCS_BUCKET_NAME;

  afterEach(async () => {
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

    if (originalBucket === undefined) {
      delete process.env.GCS_BUCKET_NAME;
    } else {
      process.env.GCS_BUCKET_NAME = originalBucket;
    }

    await shutdownTracing();
  });

  it(
    "cuelga gcs.upload del SERVER span de POST /api/v2/artifacts",
    async () => {
      process.env.GCS_BUCKET_NAME = "test-bucket";
      mocks.save.mockResolvedValue(undefined);

      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });
      let closed = false;

      const closeApp = async () => {
        if (closed) {
          return;
        }

        closed = true;
        await app.close();
      };

      try {
        const baseUrl = await listen(app);
        const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-trace-id": BUSINESS_TRACE_ID,
          },
          body: JSON.stringify(artifact),
        });

        expect(response.status).toBe(201);
        await response.arrayBuffer();
        await closeApp();
        await flushSpans();
        await exporter.forceFlush();

        const finished = exporter.getFinishedSpans();
        const serverSpans = finished.filter((span) => span.kind === SpanKind.SERVER);
        const uploads = spansNamed(exporter, "gcs.upload");
        const upload = uploads[0];

        expect(serverSpans).toHaveLength(1);
        expect(serverSpans[0]?.name).toBe("POST /api/v2/artifacts");
        expect(uploads).toHaveLength(1);
        expect(upload).toBeDefined();

        if (!upload || !serverSpans[0]) {
          return;
        }

        expect(upload.kind).toBe(SpanKind.CLIENT);
        expect(upload.spanContext().traceId).toBe(
          serverSpans[0].spanContext().traceId,
        );
        expect(upload.parentSpanContext?.spanId).toBe(
          serverSpans[0].spanContext().spanId,
        );
        expect(upload.attributes["gcs.operation"]).toBe("upload");
        expect(upload.status.code).not.toBe(SpanStatusCode.ERROR);
        expect(spansNamed(exporter, "gcs.download")).toHaveLength(0);
        expect(
          finished.filter(
            (span) =>
              span.name !== "POST /api/v2/artifacts" && span.name !== "gcs.upload",
          ),
        ).toHaveLength(0);
      } finally {
        await closeApp();
      }
    },
    20_000,
  );

  it(
    "cuelga gcs.download del SERVER span de GET /api/v2/artifacts/:traceId",
    async () => {
      process.env.GCS_BUCKET_NAME = "test-bucket";
      mocks.download.mockResolvedValue([
        Buffer.from(JSON.stringify(artifact)),
      ]);

      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });
      let closed = false;

      const closeApp = async () => {
        if (closed) {
          return;
        }

        closed = true;
        await app.close();
      };

      try {
        const baseUrl = await listen(app);
        const response = await fetch(
          `${baseUrl}/api/v2/artifacts/${BUSINESS_TRACE_ID}`,
          {
            headers: {
              "x-trace-id": BUSINESS_TRACE_ID,
            },
          },
        );

        expect(response.status).toBe(200);
        await response.arrayBuffer();
        await closeApp();
        await flushSpans();
        await exporter.forceFlush();

        const finished = exporter.getFinishedSpans();
        const serverSpans = finished.filter((span) => span.kind === SpanKind.SERVER);
        const downloads = spansNamed(exporter, "gcs.download");
        const download = downloads[0];

        expect(serverSpans).toHaveLength(1);
        expect(serverSpans[0]?.name).toBe("GET /api/v2/artifacts/:traceId");
        expect(downloads).toHaveLength(1);
        expect(download).toBeDefined();

        if (!download || !serverSpans[0]) {
          return;
        }

        expect(download.kind).toBe(SpanKind.CLIENT);
        expect(download.spanContext().traceId).toBe(
          serverSpans[0].spanContext().traceId,
        );
        expect(download.parentSpanContext?.spanId).toBe(
          serverSpans[0].spanContext().spanId,
        );
        expect(download.attributes["gcs.operation"]).toBe("download");
        expect(download.status.code).not.toBe(SpanStatusCode.ERROR);
        expect(spansNamed(exporter, "gcs.upload")).toHaveLength(0);
      } finally {
        await closeApp();
      }
    },
    20_000,
  );

  it(
    "marca gcs.upload como ERROR y conserva el HTTP 502",
    async () => {
      process.env.GCS_BUCKET_NAME = "test-bucket";
      mocks.save.mockRejectedValue(new Error("permission denied"));

      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });
      let closed = false;

      const closeApp = async () => {
        if (closed) {
          return;
        }

        closed = true;
        await app.close();
      };

      try {
        const baseUrl = await listen(app);
        const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-trace-id": BUSINESS_TRACE_ID,
          },
          body: JSON.stringify(artifact),
        });
        const body = (await response.json()) as { message?: string };

        expect(response.status).toBe(502);
        expect(body).toEqual({ message: "Error de almacenamiento" });
        await closeApp();
        await flushSpans();
        await exporter.forceFlush();

        const uploads = spansNamed(exporter, "gcs.upload");

        expect(uploads).toHaveLength(1);
        expect(uploads[0]?.status.code).toBe(SpanStatusCode.ERROR);
        expect(uploads[0]?.events.some((event) => event.name === "exception")).toBe(
          true,
        );
        expect(uploads[0]?.endTime).toBeDefined();
      } finally {
        await closeApp();
      }
    },
    20_000,
  );

  it(
    "marca gcs.download como ERROR y conserva el HTTP 404",
    async () => {
      process.env.GCS_BUCKET_NAME = "test-bucket";
      mocks.download.mockRejectedValue(
        Object.assign(new Error("No such object"), { code: 404 }),
      );

      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });
      let closed = false;

      const closeApp = async () => {
        if (closed) {
          return;
        }

        closed = true;
        await app.close();
      };

      try {
        const baseUrl = await listen(app);
        const response = await fetch(
          `${baseUrl}/api/v2/artifacts/${BUSINESS_TRACE_ID}`,
          {
            headers: {
              "x-trace-id": BUSINESS_TRACE_ID,
            },
          },
        );
        const body = (await response.json()) as { message?: string };

        expect(response.status).toBe(404);
        expect(body).toEqual({ message: "Artifact no encontrado" });
        await closeApp();
        await flushSpans();
        await exporter.forceFlush();

        const downloads = spansNamed(exporter, "gcs.download");

        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.status.code).toBe(SpanStatusCode.ERROR);
        expect(
          downloads[0]?.events.some((event) => event.name === "exception"),
        ).toBe(true);
      } finally {
        await closeApp();
      }
    },
    20_000,
  );

  it(
    "no crea un span GCS cuando el bucket no está configurado",
    async () => {
      delete process.env.GCS_BUCKET_NAME;

      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });
      let closed = false;

      const closeApp = async () => {
        if (closed) {
          return;
        }

        closed = true;
        await app.close();
      };

      try {
        const baseUrl = await listen(app);
        const response = await fetch(`${baseUrl}/api/v2/artifacts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-trace-id": BUSINESS_TRACE_ID,
          },
          body: JSON.stringify(artifact),
        });
        const body = (await response.json()) as { message?: string };

        expect(response.status).toBe(503);
        expect(body).toEqual({ message: "Error de almacenamiento" });
        await closeApp();
        await flushSpans();
        await exporter.forceFlush();

        expect(
          exporter
            .getFinishedSpans()
            .filter((span) => span.name.startsWith("gcs")),
        ).toHaveLength(0);
      } finally {
        await closeApp();
      }
    },
    20_000,
  );

  it(
    "no marca gcs.download como ERROR si el JSON descargado es inválido",
    async () => {
      process.env.GCS_BUCKET_NAME = "test-bucket";
      mocks.download.mockResolvedValue([Buffer.from("{")]);

      const exporter = new InMemorySpanExporter();
      startTracing({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const { buildApp } = await import("../../src/app");
      const app = buildApp({ logger: false });
      let closed = false;

      const closeApp = async () => {
        if (closed) {
          return;
        }

        closed = true;
        await app.close();
      };

      try {
        const baseUrl = await listen(app);
        const response = await fetch(
          `${baseUrl}/api/v2/artifacts/${BUSINESS_TRACE_ID}`,
          {
            headers: {
              "x-trace-id": BUSINESS_TRACE_ID,
            },
          },
        );
        const body = (await response.json()) as { message?: string };

        expect(response.status).toBe(502);
        expect(body).toEqual({ message: "Error de almacenamiento" });
        await closeApp();
        await flushSpans();
        await exporter.forceFlush();

        const downloads = spansNamed(exporter, "gcs.download");

        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.status.code).not.toBe(SpanStatusCode.ERROR);
      } finally {
        await closeApp();
      }
    },
    20_000,
  );
});
