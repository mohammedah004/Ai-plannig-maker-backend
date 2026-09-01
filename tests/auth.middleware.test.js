import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import * as jose from "jose";
import { env } from "../src/config/env.js";

describe("JWT Authentication Middleware Integration Tests", () => {
  it("Passes and grants access when a valid JWS token is provided in Authorization header", async () => {
    const token = await signTestToken({
      id: "user-12345",
      email: "tester@example.com",
      name: "Test User",
    });

    const res = await request(app)
      .get("/api/v1/brands")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("Returns HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
    const res = await request(app).get("/api/v1/brands");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("success", false);
    expect(res.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "يجب تسجيل الدخول للوصول إلى هذه الخدمة.",
    });
  });

  it("Returns HTTP 401 UNAUTHORIZED when token format is malformed", async () => {
    const res = await request(app)
      .get("/api/v1/brands")
      .set("Authorization", "Bearer this-is-not-a-valid-jwt-token");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("success", false);
    expect(res.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "يجب تسجيل الدخول للوصول إلى هذه الخدمة.",
    });
  });

  it("Returns HTTP 401 UNAUTHORIZED when token is expired", async () => {
    const enc = new TextEncoder();
    // Create an already-expired token
    const expiredToken = await new jose.SignJWT({ id: "expired-user", email: "expired@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1 hour ago
      .sign(enc.encode(env.AUTH_SECRET));

    const res = await request(app)
      .get("/api/v1/brands")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("success", false);
    expect(res.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "يجب تسجيل الدخول للوصول إلى هذه الخدمة.",
    });
  });

  it("Returns HTTP 401 UNAUTHORIZED when token is signed with a different secret", async () => {
    const wrongEnc = new TextEncoder();
    const wrongSecretToken = await new jose.SignJWT({ id: "hacker-user", email: "hacker@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(wrongEnc.encode("completely-wrong-secret-key-123456789"));

    const res = await request(app)
      .get("/api/v1/brands")
      .set("Authorization", `Bearer ${wrongSecretToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
