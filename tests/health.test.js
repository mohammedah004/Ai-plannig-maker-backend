import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("Health Check API Integration Tests", () => {
  it("GET /health returns HTTP 200 with standard healthy envelope", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toMatchObject({
      status: "ok",
      service: "ai-marketing-planner-backend",
    });
    expect(typeof res.body.data.uptime).toBe("number");
    expect(typeof res.body.data.timestamp).toBe("string");
    expect(res.body).toHaveProperty("message", "Service is healthy and ready.");
  });

  it("GET /nonexistent returns HTTP 404 with standard error envelope", async () => {
    const res = await request(app).get("/nonexistent-endpoint");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("success", false);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(res.body.error.message).toContain("المسار غير موجود");
  });
});
