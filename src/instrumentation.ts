import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  NoopSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const serviceName = "sports-api";

export type StartTracingOptions = {
  spanProcessors?: SpanProcessor[];
};

let sdk: NodeSDK | undefined;

export function startTracing(options: StartTracingOptions = {}): void {
  if (sdk) {
    return;
  }

  sdk = new NodeSDK({
    serviceName,
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [],
    autoDetectResources: false,
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: options.spanProcessors ?? [new NoopSpanProcessor()],
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  const current = sdk;
  sdk = undefined;

  if (current) {
    await current.shutdown();
  }

  trace.disable();
  context.disable();
  propagation.disable();
  metrics.disable();
  logs.disable();
}

export function startTracingOnImport(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "test") {
    startTracing();
  }
}

startTracingOnImport();
