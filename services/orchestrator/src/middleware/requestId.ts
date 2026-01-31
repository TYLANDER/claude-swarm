import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

/**
 * Header names for trace ID propagation
 */
const TRACE_ID_HEADERS = [
  "x-trace-id",
  "x-request-id",
  "x-correlation-id",
  "traceparent", // W3C Trace Context
] as const;

/**
 * Extract trace ID from incoming request headers
 * Supports multiple common header names
 */
function extractTraceId(req: Request): string | null {
  for (const header of TRACE_ID_HEADERS) {
    const value = req.headers[header];
    if (typeof value === "string" && value.length > 0) {
      // For W3C Trace Context, extract the trace-id portion
      if (header === "traceparent") {
        const parts = value.split("-");
        if (parts.length >= 2) {
          return parts[1];
        }
      }
      return value;
    }
  }
  return null;
}

/**
 * Middleware that ensures every request has a trace ID
 * - Uses existing trace ID from headers if present
 * - Generates a new UUID if not present
 * - Adds trace ID to response headers
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Get or generate trace ID
  const traceId = extractTraceId(req) || uuidv4();

  // Attach to request object
  req.traceId = traceId;

  // Add to response headers for client correlation
  res.setHeader("x-trace-id", traceId);

  next();
}

/**
 * Get trace ID from request or generate one
 * Useful for standalone functions
 */
export function getTraceId(req?: Request): string {
  return req?.traceId || uuidv4();
}
