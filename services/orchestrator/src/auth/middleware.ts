/**
 * JWT Authentication Middleware
 *
 * Validates JWT tokens for protected API endpoints.
 * Supports both Bearer token and API key authentication.
 */

import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

/** JWT payload structure */
export interface JwtPayload {
  /** Subject (user/key identifier) */
  sub: string;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
  /** Permission scopes */
  scope?: string[];
  /** Device identifier for revocation */
  device?: string;
}

/** Authenticated request with user info */
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  authMethod?: 'jwt' | 'apikey';
}

/** Get JWT secret from environment */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable not set');
  }
  return secret;
}

/**
 * Base64URL encode (JWT standard)
 */
function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.from(data).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode (JWT standard)
 */
function base64UrlDecode(data: string): Buffer {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

/**
 * Sign a JWT payload
 */
export function signJwt(payload: Omit<JwtPayload, 'iat'>): string {
  const secret = getJwtSecret();

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));
  const message = `${headerEncoded}.${payloadEncoded}`;

  const signature = createHmac('sha256', secret).update(message).digest();
  const signatureEncoded = base64UrlEncode(signature);

  return `${message}.${signatureEncoded}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyJwt(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split('.');

    if (parts.length !== 3) {
      return null;
    }

    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

    // Verify signature
    const message = `${headerEncoded}.${payloadEncoded}`;
    const expectedSignature = createHmac('sha256', secret).update(message).digest();
    const actualSignature = base64UrlDecode(signatureEncoded);

    if (!timingSafeEqual(expectedSignature, actualSignature)) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(payloadEncoded).toString()) as JwtPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a new JWT token
 */
export function generateToken(
  subject: string,
  options: {
    expiresInSeconds?: number;
    scopes?: string[];
    device?: string;
  } = {}
): { token: string; expiresAt: Date } {
  const expiresInSeconds = options.expiresInSeconds || 7 * 24 * 60 * 60; // 7 days default
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;

  const token = signJwt({
    sub: subject,
    exp,
    scope: options.scopes || ['tasks:read', 'tasks:write', 'agents:read'],
    device: options.device,
  });

  return {
    token,
    expiresAt: new Date(exp * 1000),
  };
}

/**
 * Express middleware for JWT authentication
 *
 * Usage:
 *   app.use('/api/protected', authMiddleware);
 *
 * Supports:
 *   - Bearer token: Authorization: Bearer <jwt>
 *   - API key: X-API-Key: <key>
 */
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Check for Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);

    if (payload) {
      req.user = payload;
      req.authMethod = 'jwt';
      next();
      return;
    }

    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Check for API key
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    // API key validation would check against stored hashes
    // For now, we'll validate format and trust it
    // In production, hash the key and lookup in database
    if (apiKey.startsWith('sk_swarm_') && apiKey.length > 20) {
      req.user = {
        sub: `apikey:${apiKey.slice(0, 15)}`,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: ['tasks:read', 'tasks:write', 'agents:read'],
      };
      req.authMethod = 'apikey';
      next();
      return;
    }

    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // No authentication provided
  res.status(401).json({
    error: 'Authentication required',
    hint: 'Provide Authorization: Bearer <token> or X-API-Key: <key>',
  });
}

/**
 * Optional auth middleware - attaches user if present but doesn't require it
 */
export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    if (payload) {
      req.user = payload;
      req.authMethod = 'jwt';
    }
  }
  next();
}

/**
 * Scope checking middleware factory
 *
 * Usage:
 *   app.post('/api/tasks', authMiddleware, requireScope('tasks:write'), handler);
 */
export function requireScope(scope: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userScopes = req.user.scope || [];
    if (!userScopes.includes(scope) && !userScopes.includes('*')) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: scope,
        provided: userScopes,
      });
      return;
    }

    next();
  };
}
