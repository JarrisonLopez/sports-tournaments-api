import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import {
  UndiciInstrumentation,
  type UndiciRequest,
} from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  NoopSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";

const nodeRequire = createRequire(process.execPath);

const serviceName = "sports-api";

const HEALTH_PATHS = new Set(["/health/live", "/health/ready"]);

const CLIENT_ROUTE_TEMPLATES: ReadonlyArray<{
  pattern: RegExp;
  route: string;
}> = [
  {
    pattern: /^\/api\/v2\/habitacion\/[^/]+$/,
    route: "/api/v2/habitacion/:id",
  },
  {
    pattern: /^\/api\/v2\/peliculas\/[^/]+$/,
    route: "/api/v2/peliculas/:id",
  },
  {
    pattern: /^\/api\/v2\/artifacts$/,
    route: "/api/v2/artifacts",
  },
];

export type StartTracingOptions = {
  spanProcessors?: SpanProcessor[];
};

let sdk: NodeSDK | undefined;
let httpInstrumentation: HttpInstrumentation | undefined;
let undiciInstrumentation: UndiciInstrumentation | undefined;

export function startTracing(options: StartTracingOptions = {}): void {
  if (sdk) {
    return;
  }

  const instrumentation = getHttpInstrumentation();
  const undici = getUndiciInstrumentation();

  sdk = new NodeSDK({
    serviceName,
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [instrumentation, undici],
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
  undiciInstrumentation?.disable();

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

function getUndiciInstrumentation(): UndiciInstrumentation {
  if (!undiciInstrumentation) {
    undiciInstrumentation = createUndiciInstrumentation();
    return undiciInstrumentation;
  }

  if (!undiciInstrumentation.isEnabled()) {
    undiciInstrumentation.enable();
  }

  return undiciInstrumentation;
}

function createUndiciInstrumentation(): UndiciInstrumentation {
  return new UndiciInstrumentation({
    requestHook(span, request) {
      const name = clientSpanName(request);

      if (name) {
        span.updateName(name);
      }
    },
  });
}

function clientSpanName(request: UndiciRequest): string | undefined {
  const path = request.path.split("?")[0] ?? "";
  const match = CLIENT_ROUTE_TEMPLATES.find((item) => item.pattern.test(path));

  if (!match) {
    return undefined;
  }

  return `${request.method.toUpperCase()} ${match.route}`;
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
