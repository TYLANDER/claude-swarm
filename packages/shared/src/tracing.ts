import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { trace, Span, SpanStatusCode, context, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

let sdk: NodeSDK | null = null;

/**
 * Configuration for OpenTelemetry initialization
 */
export interface TracingConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  /** Azure Application Insights connection string */
  connectionString?: string;
  /** Additional resource attributes */
  attributes?: Record<string, string>;
}

/**
 * Initialize OpenTelemetry SDK
 * Must be called before any other imports to ensure auto-instrumentation works
 */
export function initTracing(config: TracingConfig): void {
  if (sdk) {
    console.warn('Tracing already initialized');
    return;
  }

  const connectionString =
    config.connectionString || process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

  if (!connectionString) {
    console.warn('APPLICATIONINSIGHTS_CONNECTION_STRING not set, tracing disabled');
    return;
  }

  // Set up W3C Trace Context propagation
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  // Create Azure Monitor exporter
  const exporter = new AzureMonitorTraceExporter({
    connectionString,
  });

  // Create resource with service information
  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]:
      config.serviceVersion || process.env.npm_package_version || 'unknown',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:
      config.environment || process.env.NODE_ENV || 'development',
    ...config.attributes,
  });

  // Initialize SDK with auto-instrumentation
  sdk = new NodeSDK({
    resource,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK type mismatch between @azure/monitor-opentelemetry-exporter and @opentelemetry/sdk-node
    traceExporter: exporter as any,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation (too noisy)
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Configure HTTP instrumentation
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url || '';
            return ['/health', '/ready', '/live'].some((p) => url.includes(p));
          },
        },
      }),
    ],
  });

  sdk.start();
  console.log(`OpenTelemetry initialized for ${config.serviceName}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      ?.shutdown()
      .then(() => console.log('OpenTelemetry shut down'))
      .catch((err) => console.error('Error shutting down OpenTelemetry', err));
  });
}

/**
 * Get a tracer for the given name
 */
export function getTracer(name: string) {
  return trace.getTracer(name);
}

/**
 * Create a span for a specific operation
 */
export function startSpan(
  tracerName: string,
  spanName: string,
  attributes?: Record<string, string | number | boolean>
): Span {
  const tracer = getTracer(tracerName);
  const span = tracer.startSpan(spanName);

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }

  return span;
}

/**
 * Execute a function within a span
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = getTracer(tracerName);
  const span = tracer.startSpan(spanName);

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(
  name: string,
  attributes?: Record<string, string | number | boolean>
): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current span
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }
}

/**
 * Get the current trace ID
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

/**
 * Shutdown tracing (call during graceful shutdown)
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
