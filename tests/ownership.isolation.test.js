import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import { plansRepository } from "../src/repositories/plans.repository.js";

describe("Ownership Isolation & Repository Layer Integration Tests", () => {
  const userAId = "owner-user-a-" + Date.now();
  const userBId = "intruder-user-b-" + Date.now();

  let tokenA;
  let tokenB;

  let createdBrandId;
  let createdPlanId;

  beforeAll(async () => {
    // 1. Generate valid JWT tokens for User A and User B
    tokenA = await signTestToken({
      id: userAId,
      email: `${userAId}@example.com`,
      name: "User A (Owner)",
    });

    tokenB = await signTestToken({
      id: userBId,
      email: `${userBId}@example.com`,
      name: "User B (Intruder)",
    });

    // 2. Ensure test profiles exist in Supabase to satisfy foreign key constraints
    async function seedProfile(profile) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabaseAdmin.from("profiles").upsert(profile, { onConflict: "auth_user_id" });
        if (!error) return;
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    await seedProfile({ auth_user_id: userAId, email: `${userAId}@example.com`, name: "User A" });
    await seedProfile({ auth_user_id: userBId, email: `${userBId}@example.com`, name: "User B" });
  });

  afterAll(async () => {
    // Cleanup all created records
    try {
      if (createdPlanId) {
        await plansRepository.deletePlan(createdPlanId, userAId);
      }
      if (createdBrandId) {
        await supabaseAdmin.from("brand_profiles").delete().eq("id", createdBrandId);
      }
      await supabaseAdmin.from("profiles").delete().in("auth_user_id", [userAId, userBId]);
    } catch (cleanupErr) {
      console.warn("Test cleanup notice:", cleanupErr.message);
    }
  });

  describe("Brand Profiles Ownership Isolation", () => {
    it("User A can create a new brand profile via POST /api/v1/brands", async () => {
      const res = await request(app)
        .post("/api/v1/brands")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Brand Alpha",
          product_name: "Smart Watch Alpha",
          product_description: "Next-gen fitness tracker and watch with heart rate and sleep analytics.",
          product_category: "برمجيات / SaaS",
          target_audience: "Athletes, fitness lovers, and tech enthusiasts",
          problem_solved: "Poor health tracking and complicated analytics",
          brand_tone: ["احترافي ورسمي", "جريء وحماسي"],
          is_default: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("id");
      expect(res.body.data.name).toBe("Brand Alpha");
      expect(res.body.data.user_id).toBe(userAId);

      createdBrandId = res.body.data.id;
    });

    it("User A can retrieve their created brand profile via GET /api/v1/brands/:id", async () => {
      const res = await request(app)
        .get(`/api/v1/brands/${createdBrandId}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdBrandId);
    });

    it("User B CANNOT retrieve User A's brand (returns 404 NOT_FOUND)", async () => {
      const res = await request(app)
        .get(`/api/v1/brands/${createdBrandId}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("User B CANNOT update User A's brand (returns 404 NOT_FOUND)", async () => {
      const res = await request(app)
        .put(`/api/v1/brands/${createdBrandId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          name: "Hijacked Brand Name",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("User B CANNOT delete User A's brand (returns 404 NOT_FOUND)", async () => {
      const res = await request(app)
        .delete(`/api/v1/brands/${createdBrandId}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Marketing Plans Ownership Isolation", () => {
    it("User A creates a marketing plan directly via plansRepository", async () => {
      const plan = await plansRepository.createPlan(userAId, {
        product_name: "Alpha Plan Product",
        product_description: "Alpha Plan Description with comprehensive detail.",
        product_category: "منتجات مادية / تجارة إلكترونية",
        target_audience: "Online Shoppers looking for quality",
        problem_solved: "Finding verified deals easily",
        marketing_objective: "brand_awareness",
        brand_tone: ["ودود وقريب للقلب"],
        brand_profile_id: createdBrandId,
        status: "draft",
      });

      expect(plan).toHaveProperty("id");
      expect(plan.user_id).toBe(userAId);
      createdPlanId = plan.id;
    });

    it("User A can view their plan via GET /api/v1/plans/:id", async () => {
      const res = await request(app)
        .get(`/api/v1/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdPlanId);
      expect(res.body.data.product_name).toBe("Alpha Plan Product");
    });

    it("User B CANNOT view User A's plan via GET /api/v1/plans/:id (returns 404)", async () => {
      const res = await request(app)
        .get(`/api/v1/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("User B's plan list (GET /api/v1/plans) does NOT contain User A's plan", async () => {
      const res = await request(app)
        .get("/api/v1/plans")
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const containsUserAPlan = res.body.data.some((p) => p.id === createdPlanId);
      expect(containsUserAPlan).toBe(false);
    });

    it("User B CANNOT delete User A's plan via DELETE /api/v1/plans/:id (returns 404)", async () => {
      const res = await request(app)
        .delete(`/api/v1/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("POST /api/v1/plans enforces validation on missing fields (400 VALIDATION_ERROR)", async () => {
      const res = await request(app)
        .post("/api/v1/plans")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ product_name: "Incomplete Plan" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("User A can successfully delete their own plan via DELETE /api/v1/plans/:id", async () => {
      const res = await request(app)
        .delete(`/api/v1/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify plan no longer exists
      const verifyRes = await request(app)
        .get(`/api/v1/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect(verifyRes.status).toBe(404);

      createdPlanId = null;
    });
  });
});
