import { verifyAuthToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Express Authentication Middleware
 * Validates NextAuth JWT from Authorization: Bearer <token>
 * Attaches { userId, email, name } to req.user on success.
 * Rejects with standard UNAUTHORIZED (401) on failure.
 */
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn({ path: req.path, ip: req.ip }, "[Auth] Missing or invalid Authorization header format");
      throw new UnauthorizedError("يجب تسجيل الدخول للوصول إلى هذه الخدمة.");
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      logger.warn({ path: req.path, ip: req.ip }, "[Auth] Empty bearer token");
      throw new UnauthorizedError("يجب تسجيل الدخول للوصول إلى هذه الخدمة.");
    }

    try {
      const userPayload = await verifyAuthToken(token);

      req.user = {
        userId: userPayload.userId,
        email: userPayload.email,
        name: userPayload.name,
        tokenType: userPayload.tokenType || "internal",
      };

      return next();
    } catch (verifyErr) {
      logger.warn(
        { path: req.path, ip: req.ip, reason: verifyErr.message },
        "[Auth] JWT verification failed"
      );
      throw new UnauthorizedError("يجب تسجيل الدخول للوصول إلى هذه الخدمة.");
    }
  } catch (err) {
    next(err);
  }
}
