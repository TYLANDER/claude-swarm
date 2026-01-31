import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";
import { Request, Response } from "express";

/**
 * Rate limit configuration interface
 */
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message: string;
}

/**
 * Custom key generator that handles proxied requests
 */
function getClientIp(req: Request): string {
  // Trust X-Forwarded-For in production (behind Azure Front Door / Load Balancer)
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Create a rate limiter with standard configuration
 */
function createLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.maxRequests,
    message: { error: config.message },
    standardHeaders: true, // Return RateLimit-* headers
    legacyHeaders: false, // Disable X-RateLimit-* headers
    keyGenerator: getClientIp,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: config.message,
        retryAfter: Math.ceil(config.windowMs / 1000),
      });
    },
  });
}

/**
 * Rate limiter for task submission
 * 10 requests per minute per IP
 */
export const taskSubmissionLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  message: "Too many task submissions. Please wait before submitting more tasks.",
});

/**
 * Rate limiter for status queries
 * 60 requests per minute per IP
 */
export const statusQueryLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  message: "Too many status requests. Please reduce polling frequency.",
});

/**
 * Rate limiter for general API access
 * 100 requests per minute per IP
 */
export const generalLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  message: "Too many requests. Please slow down.",
});

/**
 * Track WebSocket connection attempts per IP
 * Simple in-memory implementation (consider Redis for production at scale)
 */
const wsConnections = new Map<string, { count: number; resetAt: number }>();
const WS_WINDOW_MS = 60 * 1000;
const WS_MAX_CONNECTIONS = 5;

/**
 * Check if WebSocket connection should be allowed
 */
export function checkWebSocketRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = wsConnections.get(ip);

  // Clean up old record
  if (record && record.resetAt <= now) {
    wsConnections.delete(ip);
  }

  const current = wsConnections.get(ip);

  if (!current) {
    wsConnections.set(ip, {
      count: 1,
      resetAt: now + WS_WINDOW_MS,
    });
    return true;
  }

  if (current.count >= WS_MAX_CONNECTIONS) {
    return false;
  }

  current.count++;
  return true;
}

/**
 * Periodic cleanup of stale WebSocket rate limit records
 * Call this periodically (e.g., every 5 minutes)
 */
export function cleanupWebSocketRateLimits(): void {
  const now = Date.now();
  for (const [ip, record] of wsConnections) {
    if (record.resetAt <= now) {
      wsConnections.delete(ip);
    }
  }
}
