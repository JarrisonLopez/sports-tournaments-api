export class HotelTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Hotel request timed out after ${timeoutMs}ms`);
    this.name = "HotelTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Ejecuta una función con timeout y AbortSignal.
 * Cancela el AbortController al vencer el tiempo.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new HotelTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
