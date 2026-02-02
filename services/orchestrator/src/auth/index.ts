/**
 * Authentication module exports
 */

export {
  authMiddleware,
  optionalAuthMiddleware,
  requireScope,
  generateToken,
  signJwt,
  verifyJwt,
  type JwtPayload,
  type AuthenticatedRequest,
} from './middleware.js';
