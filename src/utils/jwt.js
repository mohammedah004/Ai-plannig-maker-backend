import * as jose from "jose";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Derives HKDF encryption keys for NextAuth / Auth.js JWE tokens
 */
async function getDerivedEncryptionKey(secret, salt, info = "Auth.js Generated Encryption Key", length = 32) {
  const enc = new TextEncoder();
  return await jose.hkdf(
    "sha256",
    enc.encode(secret),
    enc.encode(salt),
    enc.encode(info),
    length
  );
}

/**
 * Verifies internal service-to-service tokens signed with INTERNAL_API_SECRET
 *
 * @param {string} token
 * @returns {Promise<{ userId: string, email: string|null, name: string|null, tokenType: "internal", [key: string]: any }>}
 */
export async function verifyInternalApiToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token must be a non-empty string");
  }

  const enc = new TextEncoder();
  const secret = env.INTERNAL_API_SECRET;

  const { payload } = await jose.jwtVerify(token, enc.encode(secret), {
    algorithms: ["HS256", "HS384", "HS512"],
  });

  const userId = payload.id || payload.sub || payload.userId || payload.auth_user_id;
  if (!userId && !payload.email) {
    throw new Error("Internal token payload missing user identifier");
  }

  return {
    userId: String(userId || payload.email),
    email: payload.email || null,
    name: payload.name || null,
    tokenType: "internal",
    ...payload,
  };
}

/**
 * Verifies end-user NextAuth session tokens signed or encrypted with AUTH_SECRET
 *
 * @param {string} token
 * @returns {Promise<{ userId: string, email: string|null, name: string|null, tokenType: "session", [key: string]: any }>}
 */
export async function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token must be a non-empty string");
  }

  const parts = token.split(".");
  const secret = env.AUTH_SECRET;
  const enc = new TextEncoder();

  // 1. Try JWS signed with AUTH_SECRET
  if (parts.length === 3) {
    const { payload } = await jose.jwtVerify(token, enc.encode(secret), {
      algorithms: ["HS256", "HS384", "HS512"],
    });

    const userId = payload.id || payload.sub || payload.userId || payload.auth_user_id;
    if (!userId && !payload.email) {
      throw new Error("Session token payload missing user identifier");
    }

    return {
      userId: String(userId || payload.email),
      email: payload.email || null,
      name: payload.name || null,
      tokenType: "session",
      ...payload,
    };
  }

  // 2. Try JWE encrypted with AUTH_SECRET
  if (parts.length === 5) {
    const salts = [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "next-auth.session-token",
      "__Secure-next-auth.session-token",
      "",
    ];

    const infos = [
      "Auth.js Generated Encryption Key",
      "NextAuth.js Generated Encryption Key",
    ];

    for (const salt of salts) {
      for (const info of infos) {
        // Try 32-byte key (A256GCM)
        try {
          const key32 = await getDerivedEncryptionKey(secret, salt, info, 32);
          const { payload } = await jose.jwtDecrypt(token, key32);
          const parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload;

          const userId = parsedPayload.id || parsedPayload.sub || parsedPayload.userId || parsedPayload.auth_user_id;
          if (userId || parsedPayload.email) {
            return {
              userId: String(userId || parsedPayload.email),
              email: parsedPayload.email || null,
              name: parsedPayload.name || null,
              tokenType: "session",
              ...parsedPayload,
            };
          }
        } catch {
          // Continue trying
        }

        // Try 64-byte key (A256CBC-HS512)
        try {
          const key64 = await getDerivedEncryptionKey(secret, salt, info, 64);
          const { payload } = await jose.jwtDecrypt(token, key64);
          const parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload;

          const userId = parsedPayload.id || parsedPayload.sub || parsedPayload.userId || parsedPayload.auth_user_id;
          if (userId || parsedPayload.email) {
            return {
              userId: String(userId || parsedPayload.email),
              email: parsedPayload.email || null,
              name: parsedPayload.name || null,
              tokenType: "session",
              ...parsedPayload,
            };
          }
        } catch {
          // Continue trying
        }
      }
    }
  }

  throw new Error("Unable to decrypt or verify session token");
}

/**
 * Universal token verification:
 * 1. Checks INTERNAL_API_SECRET first (fast path for service-to-service calls from Next.js server).
 * 2. Falls back to AUTH_SECRET (for direct user session tokens).
 *
 * @param {string} token
 * @returns {Promise<{ userId: string, email: string|null, name: string|null, tokenType: "internal"|"session", [key: string]: any }>}
 */
export async function verifyAuthToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token must be a non-empty string");
  }

  // 1. Try internal service token path (INTERNAL_API_SECRET)
  if (env.INTERNAL_API_SECRET) {
    try {
      return await verifyInternalApiToken(token);
    } catch (internalErr) {
      logger.debug({ reason: internalErr.message }, "[JWT] Internal token check failed, checking session token...");
    }
  }

  // 2. Try session token path (AUTH_SECRET)
  if (env.AUTH_SECRET) {
    try {
      return await verifySessionToken(token);
    } catch (sessionErr) {
      logger.debug({ reason: sessionErr.message }, "[JWT] Session token check failed");
    }
  }

  throw new Error("Unable to verify token signature or decrypt token payload");
}

/**
 * Signs an internal service-to-service token with INTERNAL_API_SECRET
 */
export async function signInternalApiToken(payload, expiresIn = "5m") {
  const enc = new TextEncoder();
  return await new jose.SignJWT({
    iss: "ai-marketing-planner-frontend",
    aud: "ai-marketing-planner-backend",
    ...payload,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(enc.encode(env.INTERNAL_API_SECRET));
}

/**
 * Test helper to sign a token with either INTERNAL_API_SECRET or AUTH_SECRET
 */
export async function signTestToken(payload, expiresIn = "1h", useInternalSecret = true) {
  const enc = new TextEncoder();
  const secret = useInternalSecret ? (env.INTERNAL_API_SECRET || env.AUTH_SECRET) : env.AUTH_SECRET;
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(enc.encode(secret));
}
