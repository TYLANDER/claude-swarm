import pino, { Logger, LoggerOptions } from "pino";

/**
 * Base context included in all log entries
 */
export interface LogContext {
  service: string;
  version?: string;
  environment?: string;
}

/**
 * Request-specific context
 */
export interface RequestContext {
  traceId?: string;
  taskId?: string;
  agentId?: string;
  userId?: string;
}

/**
 * Create a configured Pino logger
 */
export function createLogger(context: LogContext): Logger {
  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL || "info",
    base: {
      service: context.service,
      version: context.version || process.env.npm_package_version,
      environment: context.environment || process.env.NODE_ENV || "development",
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Use pretty printing in development
  if (process.env.NODE_ENV !== "production" && !process.env.LOG_JSON) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    });
  }

  return pino(options);
}

/**
 * Create a child logger with additional context
 */
export function withContext(
  logger: Logger,
  context: RequestContext,
): Logger {
  return logger.child(context);
}

/**
 * Create a child logger for a specific task
 */
export function withTask(
  logger: Logger,
  taskId: string,
  agentId?: string,
): Logger {
  return logger.child({ taskId, agentId });
}

/**
 * Create a child logger for a specific request
 */
export function withRequest(
  logger: Logger,
  traceId: string,
  userId?: string,
): Logger {
  return logger.child({ traceId, userId });
}

/**
 * Log levels
 */
export const LogLevel = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
} as const;

/**
 * Pre-configured loggers for each service
 */
export function createOrchestratorLogger(): Logger {
  return createLogger({
    service: "orchestrator",
    environment: process.env.NODE_ENV,
  });
}

export function createAgentWorkerLogger(agentId: string): Logger {
  const logger = createLogger({
    service: "agent-worker",
    environment: process.env.NODE_ENV,
  });
  return logger.child({ agentId });
}

/**
 * Utility to safely stringify errors
 */
export function serializeError(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: (error as { code?: string }).code,
    };
  }
  return { message: String(error) };
}

/**
 * Create a redacted version of sensitive data for logging
 */
export function redact(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars) {
    return "*".repeat(value.length);
  }
  return value.slice(0, visibleChars) + "*".repeat(value.length - visibleChars);
}
