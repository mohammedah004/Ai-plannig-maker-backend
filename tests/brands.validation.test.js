import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import { supabaseAdmin } from "../src/config/supabase.js";

describe("Brand Request Validation Middleware Integration Tests", () => {
  const userId = "validation-user-" + Date.now();
  let token;
  let testBrandId;

  beforeAll(async () => {
    token = await signTestToken({
      id: userId,
      email: `${userId}@example.com`,
      name: "Validation Test User",
    });

    // Seed test profile for foreign key constraint
    await supabaseAdmin.from("profiles").upsert(
      {
        auth_user_id: userId,
        email: `${userId}@example.com`,
        name: "Validation User",
      },
      { onConflict: "auth_user_id" }
    );
  });

  afterAll(async () => {
    try {
      if (testBrandId) {
        await supabaseAdmin.from("brand_profiles").delete().eq("id", testBrandId);
      }
      await supabaseAdmin.from("profiles").delete().eq("auth_user_id", userId);
    } catch (err) {
      console.warn("Cleanup warning:", err.message);
    }
  });

  describe("POST /api/v1/brands (Create Validation)", () => {
    it("Fails with HTTP 400 and VALIDATION_ERROR when required fields are missing", async () => {
      const res = await request(app)
        .post("/api/v1/brands")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Brand",
          // missing product_name, product_description, target_audience, problem_solved, product_category, brand_tone
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "يرجى مراجعة الحقول المدخلة والتأكد من صحتها.",
      });
      expect(res.body.error.details).toHaveProperty("product_name");
      expect(res.body.error.details).toHaveProperty("product_description");
      expect(res.body.error.details).toHaveProperty("brand_tone");
    });

    it("Fails with HTTP 400 when field types or constraints are invalid", async () => {
      const res = await request(app)
        .post("/api/v1/brands")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "A", // too short (min 2)
          product_name: "Valid Product",
          product_description: "Short", // too short (min 10)
          product_category: "Tech",
          target_audience: "Devs", // too short (min 5)
          problem_solved: "Bugs", // too short (min 5)
          brand_tone: "not-an-array", // should be array
          is_default: "not-a-boolean", // should be boolean
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.name).toContain("حرفين على الأقل");
      expect(res.body.error.details.product_description).toContain("10 أحرف");
      expect(res.body.error.details.brand_tone).toContain("قائمة نصوص");
      expect(res.body.error.details.is_default).toContain("boolean");
    });

    it("Fails with HTTP 400 when brand_tone exceeds maximum of 3 items", async () => {
      const res = await request(app)
        .post("/api/v1/brands")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Brand Tone Test",
          product_name: "Product Test",
          product_description: "Detailed product description for testing purposes.",
          product_category: "SaaS",
          target_audience: "Developers and teams",
          problem_solved: "Efficiency issues",
          brand_tone: ["Tone 1", "Tone 2", "Tone 3", "Tone 4"], // > 3
        });

      expect(res.status).toBe(400);
      expect(res.body.error.details.brand_tone).toContain("3 نبرات كحد أقصى");
    });

    it("Succeeds with HTTP 201 when payload is fully valid and sanitizes/coerces fields", async () => {
      const res = await request(app)
        .post("/api/v1/brands")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "  Brand Clean Name  ",
          product_name: "  Clean Product  ",
          product_description: "This is a clean and verified description of the test brand.",
          product_category: "برمجيات / SaaS",
          target_audience: "Tech startup founders and developers",
          problem_solved: "Automating marketing planning workflows",
          brand_tone: ["احترافي ورسمي", "عفوي وغير متكلف"],
          website_url: "example.com",
          additional_context: "  Extra notes  ",
          is_default: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Brand Clean Name"); // trimmed
      expect(res.body.data.product_name).toBe("Clean Product"); // trimmed
      expect(res.body.data.website_url).toBe("https://example.com"); // normalized url
      expect(res.body.data.is_default).toBe(true);

      testBrandId = res.body.data.id;
    });
  });

  describe("PUT /api/v1/brands/:id (Update Validation)", () => {
    it("Fails with HTTP 400 when empty body is sent for update", async () => {
      const res = await request(app)
        .put(`/api/v1/brands/${testBrandId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details._form).toContain("يجب تقديم حقل واحد على الأقل للتحديث");
    });

    it("Succeeds with HTTP 200 when updating valid partial fields", async () => {
      const res = await request(app)
        .put(`/api/v1/brands/${testBrandId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Brand Nickname",
          brand_tone: ["جريء وحماسي"],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Updated Brand Nickname");
      expect(res.body.data.brand_tone).toEqual(["جريء وحماسي"]);
    });
  });
});
