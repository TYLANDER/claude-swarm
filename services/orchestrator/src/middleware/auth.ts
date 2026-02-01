import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { IncomingMessage } from "http";

export interface JwtPayload {
  sub: string; // User/service ID
  iat: number;
  exp: number;
  scope?: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;

function getSecret(): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return JWT_SECRET;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Verify JWT token and return payload
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}

/**
 * Express middleware for JWT authentication
 * Protects routes requiring authentication
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Invalid token" });
    } else {
      res.status(500).json({ error: "Authentication error" });
    }
  }
}

/**
 * Middleware factory for scope-based authorization
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const userScopes = req.user.scope || [];
    const hasScope = requiredScopes.some((scope) => userScopes.includes(scope));

    if (!hasScope) {
      res.status(403).json({
        error: "Insufficient permissions",
        required: requiredScopes,
      });
      return;
    }

    next();
  };
}

/**
 * Authenticate WebSocket connection
 * Extracts token from query param or protocol header
 */
export function authenticateWebSocket(
  request: IncomingMessage,
): JwtPayload | null {
  // Try query parameter first (ws://host/path?token=xxx)
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  const tokenFromQuery = url.searchParams.get("token");

  // Try Sec-WebSocket-Protocol header (subprotocol auth)
  const protocolHeader = request.headers["sec-websocket-protocol"];
  let tokenFromProtocol: string | undefined;

  if (protocolHeader) {
    const protocols = protocolHeader.split(",").map((p) => p.trim());
    const authProtocol = protocols.find((p) => p.startsWith("auth."));
    if (authProtocol) {
      tokenFromProtocol = authProtocol.slice(5); // Remove "auth." prefix
    }
  }

  const token = tokenFromQuery || tokenFromProtocol;

  if (!token) {
    return null;
  }

  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * Generate a JWT token (for testing/development)
 */
export function generateToken(
  sub: string,
  options?: { scope?: string[]; expiresIn?: string | number },
): string {
  const payload = {
    sub,
    scope: options?.scope || [],
  };

  // expiresIn accepts strings like "24h" or numbers (seconds)
  return jwt.sign(payload, getSecret(), {
    expiresIn: options?.expiresIn ?? "24h",
  } as jwt.SignOptions);
}
