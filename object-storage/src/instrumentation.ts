import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  NoopSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";

const nodeRequire = createRequire(process.execPath);

const serviceName = "object-storage";

const HEALTH_PATHS = new Set(["/health/live", "/health/ready"]);

export type StartTracingOptions = {
  spanProcessors?: SpanProcessor[];
};

let sdk: NodeSDK | undefined;
let httpInstrumentation: HttpInstrumentation | undefined;

export function startTracing(options: StartTracingOptions = {}): void {
  if (sdk) {
    return;
  }

  const instrumentation = getHttpInstrumentation();

  sdk = new NodeSDK({
    serviceName,
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [instrumentation],
    autoDetectResources: false,
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: options.spanProcessors ?? [new NoopSpanProcessor()],
  });

  sdk.start();
  loadInstrumentedHttpModules();
}

export async function shutdownTracing(): Promise<void> {
  const currentSdk = sdk;
  sdk = undefined;

  httpInstrumentation?.disable();

  if (currentSdk) {
    await currentSdk.shutdown();
  }

  trace.disable();
  context.disable();
  propagation.disable();
  metrics.disable();
  logs.disable();
}

function getHttpInstrumentation(): HttpInstrumentation {
  if (!httpInstrumentation) {
    httpInstrumentation = createHttpInstrumentation();
    return httpInstrumentation;
  }

  if (!httpInstrumentation.isEnabled()) {
    httpInstrumentation.enable();
  }

  return httpInstrumentation;
}

function createHttpInstrumentation(): HttpInstrumentation {
  return new HttpInstrumentation({
    disableIncomingRequestInstrumentation: false,
    disableOutgoingRequestInstrumentation: true,
    ignoreIncomingRequestHook: isIgnoredIncomingRequest,
  });
}

function isIgnoredIncomingRequest(request: IncomingMessage): boolean {
  const path = request.url?.split("?")[0] ?? "";

  return HEALTH_PATHS.has(path);
}

function loadInstrumentedHttpModules(): void {
  nodeRequire("node:http");
  nodeRequire("node:https");
}

export function startTracingOnImport(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "test") {
    startTracing();
  }
}

startTracingOnImport();
