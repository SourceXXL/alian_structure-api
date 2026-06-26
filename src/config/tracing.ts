import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  trace,
  SpanStatusCode,
  Span,
  context,
  propagation,
  ROOT_CONTEXT,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

const SERVICE_NAME = "alian-structure-api";

function buildExporters(): SpanExporter[] {
  const exporters: SpanExporter[] = [];

  // OTLP exporter (primary — works with Jaeger 1.41+ OTLP endpoint)
  exporters.push(
    new OTLPTraceExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        "http://localhost:4318/v1/traces",
    }),
  );

  // Legacy Jaeger Thrift exporter (for older Jaeger deployments)
  if (process.env.JAEGER_AGENT_HOST || process.env.JAEGER_ENDPOINT) {
    exporters.push(
      new JaegerExporter({
        endpoint:
          process.env.JAEGER_ENDPOINT ||
          `http://${process.env.JAEGER_AGENT_HOST || "localhost"}:14268/api/traces`,
      }),
    );
  }

  return exporters;
}

const resource = resourceFromAttributes({
  "service.name": SERVICE_NAME,
  "service.version": process.env.npm_package_version || "1.0.0",
  "deployment.environment": process.env.NODE_ENV || "development",
});

let sdk: NodeSDK;

function buildSdk(): NodeSDK {
  const exporters = buildExporters();
  const processors = exporters.map((exp) => new BatchSpanProcessor(exp));

  return new NodeSDK({
    resource,
    spanProcessors: processors,
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is noisy; disable it
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // Ensure HTTP instrumentation captures request/response headers
        "@opentelemetry/instrumentation-http": {
          headersToSpanAttributes: {
            server: {
              requestHeaders: ["x-request-id", "x-correlation-id"],
              responseHeaders: ["content-type"],
            },
          },
        },
      }),
    ],
  });
}

export const startTracing = async (): Promise<void> => {
  try {
    sdk = buildSdk();
    sdk.start();
    console.log("OpenTelemetry tracing initialized");
  } catch (err) {
    console.error("Failed to start OpenTelemetry SDK:", err);
  }
};

export const shutdownTracing = async (): Promise<void> => {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    console.log("OpenTelemetry tracing shut down");
  } catch (error) {
    console.error("Error shutting down tracing:", error);
  }
};

export const getTracer = () =>
  trace.getTracer(SERVICE_NAME, process.env.npm_package_version || "1.0.0");

/**
 * Execute `fn` inside a new active span, automatically setting OK/ERROR
 * status and ending the span when the promise resolves or rejects.
 */
export const createSpan = async <T>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> => {
  return getTracer().startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
};
