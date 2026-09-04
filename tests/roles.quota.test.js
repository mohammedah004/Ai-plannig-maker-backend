import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import { supabaseAdmin } from "../src/config/supabase.js";

describe("Roles & Daily Quota Control Integration Tests", () => {
  const testUserId = "quota-test-user-" + Date.now();
  const testAdminId = "quota-test-admin-" + Date.now();
  let userToken;
  let adminToken;

  const validPlanPayload = {
    product_name: "تطبيق مدار للاختبار",
    product_description: "تطبيق ذكاء اصطناعي لإدارة وتخطيط الحملات التسويقية بالكامل.",
    product_category: "software_tech",
    target_audience: "أصحاب المشاريع الرقمية والمسوقين المحترفين في العالم العربي.",
    problem_solved: "صعوبة إعداد خطط محتوى تسويقي متكاملة بشكل مستمر.",
    marketing_objective: "lead_generation",
    brand_tone: ["احترافية وموثوقة", "حماسية ومحفزة"],
  };

  beforeAll(async () => {
    // 1. Create test user profile with role 'user'
    await supabaseAdmin.from("profiles").upsert({
      auth_user_id: testUserId,
      email: `${testUserId}@test.com`,
      name: "Test Normal User",
      role: "user",
    });

    // 2. Create test admin profile with role 'admin'
    await supabaseAdmin.from("profiles").upsert({
      auth_user_id: testAdminId,
      email: `${testAdminId}@test.com`,
      name: "Test Admin User",
      role: "admin",
    });

    userToken = await signTestToken({
      id: testUserId,
      email: `${testUserId}@test.com`,
      name: "Test Normal User",
    });

    adminToken = await signTestToken({
      id: testAdminId,
      email: `${testAdminId}@test.com`,
      name: "Test Admin User",
    });
  });

  afterAll(async () => {
    // Cleanup created test records
    await supabaseAdmin.from("marketing_plans").delete().eq("user_id", testUserId);
    await supabaseAdmin.from("marketing_plans").delete().eq("user_id", testAdminId);
    await supabaseAdmin.from("profiles").delete().eq("auth_user_id", testUserId);
    await supabaseAdmin.from("profiles").delete().eq("auth_user_id", testAdminId);
  });

  it("GET /api/v1/plans/quota returns full quota info for normal user (1/day)", async () => {
    const res = await request(app)
      .get("/api/v1/plans/quota")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      role: "user",
      dailyLimit: 1,
      isUnlimited: false,
    });
    expect(typeof res.body.data.used).toBe("number");
    expect(typeof res.body.data.remaining).toBe("number");
    expect(res.body.data.resetsAt).toBeDefined();
  });

  it("GET /api/v1/plans/quota returns unlimited quota for admin user", async () => {
    const res = await request(app)
      .get("/api/v1/plans/quota")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      role: "admin",
      dailyLimit: null,
      remaining: null,
      isUnlimited: true,
    });
  });

  it("Atomic Concurrency Lock: Rejects simultaneous duplicate generation requests for the same user", async () => {
    // Send two requests in parallel for testUserId
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/v1/plans")
        .set("Authorization", `Bearer ${userToken}`)
        .send(validPlanPayload),
      request(app)
        .post("/api/v1/plans")
        .set("Authorization", `Bearer ${userToken}`)
        .send(validPlanPayload),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // One request must succeed (201) and the other must be blocked (409 JOB_IN_PROGRESS)
    expect(statuses).toEqual([201, 409]);

    const blockedRes = res1.status === 409 ? res1 : res2;
    expect(blockedRes.body.error.code).toBe("JOB_IN_PROGRESS");
  });

  it("Quota Enforcement: Blocks subsequent creation once user has completed 1 plan today (429 QUOTA_EXCEEDED)", async () => {
    const quotaExhaustedUserId = "quota-exhausted-user-" + Date.now();
    await supabaseAdmin.from("profiles").upsert({
      auth_user_id: quotaExhaustedUserId,
      email: `${quotaExhaustedUserId}@test.com`,
      name: "Exhausted User",
      role: "user",
    });

    const exhaustedToken = await signTestToken({
      id: quotaExhaustedUserId,
      email: `${quotaExhaustedUserId}@test.com`,
      name: "Exhausted User",
    });

    // Insert 1 completed plan for today with brand_tone (not-null constraint)
    const { error: insertErr } = await supabaseAdmin.from("marketing_plans").insert({
      user_id: quotaExhaustedUserId,
      product_name: "خطة مكتملة تجريبية",
      product_description: "وصف الخطة",
      product_category: "software_tech",
      target_audience: "الجمهور",
      problem_solved: "المشكلة",
      marketing_objective: "lead_generation",
      brand_tone: ["احترافية وموثوقة"],
      status: "completed",
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      throw new Error(`Failed to seed completed plan: ${insertErr.message}`);
    }

    const res = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${exhaustedToken}`)
      .send(validPlanPayload);

    // Cleanup
    await supabaseAdmin.from("marketing_plans").delete().eq("user_id", quotaExhaustedUserId);
    await supabaseAdmin.from("profiles").delete().eq("auth_user_id", quotaExhaustedUserId);

    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    expect(res.body.error.details.used).toBeGreaterThanOrEqual(1);
    expect(res.body.error.details.limit).toBe(1);
    expect(res.body.error.details.resetsAt).toBeDefined();
  });
});
