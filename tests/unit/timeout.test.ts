import { describe, expect, it } from "vitest";

import { HotelTimeoutError, withTimeout } from "../../src/resilience/timeout";

describe("withTimeout", () => {
  it("resuelve dentro del presupuesto", async () => {
    const value = await withTimeout(200, async () => 42);
    expect(value).toBe(42);
  });

  it("cancela y lanza HotelTimeoutError", async () => {
    await expect(
      withTimeout(30, async (signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), 200);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
        return "late";
      }),
    ).rejects.toBeInstanceOf(HotelTimeoutError);
  });
});
