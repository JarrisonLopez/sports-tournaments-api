import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class {
      bucket() {
        return {
          file() {
            return {};
          },
        };
      }
    },
  };
});

import { buildApp } from "../../src/app";

describe("Health checks de Object Storage", () => {
  const originalBucket = process.env.GCS_BUCKET_NAME;

  afterEach(() => {
    if (originalBucket === undefined) {
      delete process.env.GCS_BUCKET_NAME;
    } else {
      process.env.GCS_BUCKET_NAME = originalBucket;
    }
  });

  it("responde 200 en liveness", async () => {
    const app = buildApp();

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      status: "ok",
    });

    await app.close();
  });

  it("responde 200 en readiness cuando el bucket está configurado", async () => {
    process.env.GCS_BUCKET_NAME = "test-bucket";
    const app = buildApp();

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      status: "ready",
    });

    await app.close();
  });

  it("responde 503 en readiness cuando el bucket no está configurado", async () => {
    delete process.env.GCS_BUCKET_NAME;
    const app = buildApp();

    const respuesta = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json()).toEqual({
      status: "not_ready",
    });

    await app.close();
  });
});
