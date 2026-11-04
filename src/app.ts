import { trace } from "@opentelemetry/api";
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import { MetricReader } from "@opentelemetry/sdk-metrics";

import {
  API_TRACK_HEADER,
  API_VERSION_HEADER,
  resolveRuntimeIdentity,
  RuntimeIdentity,
} from "./config/runtime-identity";
import { torneoRoutes } from "./routes/torneo.routes";
import { canchaRoutes } from "./routes/cancha.routes";
import { jugadorRoutes } from "./routes/jugador.routes";
import { healthRoutes } from "./routes/health.routes";
import { v2Routes } from "./routes/v2";
import { v3Routes } from "./routes/v3";
import {
  createHttpMetrics,
  registerRedMetrics,
  resolveHttpRoute,
} from "./observability/metrics";

export type BuildAppOptions = {
  metricsReader?: MetricReader;
  logger?: FastifyServerOptions["logger"];
  /** Override explícito para tests; en runtime se usan API_VERSION / API_TRACK. */
  identity?: RuntimeIdentity;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const identity = options.identity ?? resolveRuntimeIdentity();

  registerRuntimeIdentityHeaders(app, identity);
  registerServerSpanRoute(app);
  registerRedMetrics(
    app,
    createHttpMetrics("sports-api", options.metricsReader),
  );

  app.get("/", async () => {
    return {
      message: "API de Torneos Deportivos funcionando",
    };
  });

  app.register(healthRoutes);
  app.register(torneoRoutes);
  app.register(canchaRoutes);
  app.register(jugadorRoutes);

  app.register(v2Routes, {
    prefix: "/api/v2",
  });
  app.register(v3Routes, {
    prefix: "/api/v3",
  });

  return app;
}

function registerRuntimeIdentityHeaders(
  app: FastifyInstance,
  identity: RuntimeIdentity,
): void {
  // onSend cubre 2xx/4xx/5xx y el 404 por defecto de Fastify sin alterar el body.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header(API_VERSION_HEADER, identity.version);
    reply.header(API_TRACK_HEADER, identity.track);
    return payload;
  });
}

function registerServerSpanRoute(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    const span = trace.getActiveSpan();

    if (!span) {
      return;
    }

    const route = resolveHttpRoute(request);
    span.updateName(`${request.method} ${route}`);
    span.setAttribute("http.route", route);
  });
}