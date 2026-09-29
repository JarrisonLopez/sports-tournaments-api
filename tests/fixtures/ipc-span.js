"use strict";

const { ExportResultCode } = require("@opentelemetry/core");

function serializeSpan(span) {
  const attributes = span.attributes ?? {};
  const serviceName = span.resource?.attributes?.["service.name"];

  return {
    name: span.name,
    kind: span.kind,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    serviceName: typeof serviceName === "string" ? serviceName : null,
    "url.path": attributes["url.path"] ?? null,
    "http.route": attributes["http.route"] ?? null,
  };
}

class IpcSpanExporter {
  export(spans, resultCallback) {
    if (typeof process.send === "function" && process.connected) {
      process.send({
        type: "spans",
        spans: spans.map(serializeSpan),
      });
    }

    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

module.exports = {
  IpcSpanExporter,
};
