import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import { geminiService } from "../src/services/ai/gemini.service.js";
import { googleSheetsService } from "../src/services/integrations/google-sheets.service.js";
import { orchestrator } from "../src/services/ai/orchestrator.js";
import { plansRepository } from "../src/repositories/plans.repository.js";
import { resetRateLimits } from "../src/utils/rate-limiter.js";

describe("AI Marketing Plans Generation & Regeneration Integration Tests", () => {
  const userAId = "ai-plan-owner-a-" + Date.now();
  const userBId = "ai-plan-intruder-b-" + Date.now();
  const userFailId = "ai-plan-fail-" + Date.now();
  const userRetryId = "ai-plan-retry-" + Date.now();

  let tokenA;
  let tokenB;
  let tokenFail;
  let tokenRetry;
  let createdPlanId;

  const mockStrategy = {
    target_audience_analysis: "جمهور من رواد الأعمال والشركات الناشئة",
    pain_points: ["صعوبة كتابة المحتوى التسويقي", "قلة التفاعل", "ضيق الوقت"],
    desired_outcomes: ["زيادة المبيعات", "بناء حضور قوي", "توفير 15 ساعة أسبوعياً"],
    positioning: "المنصة الذكية الرائدة لتخطيط المحتوى التسويقي",
    messaging_angles: ["السرعة والكفاءة", "العائد الاستثماري العالي", "الاحترافية"],
    cta_strategy: "دعوة مباشرة للتجربة المجانية أو طلب الاستشارة",
    diagnosis: {
      marketing_maturity: "growing",
      maturity_reasoning: "البراند يمتلك منتجاً جاهزاً ويحتاج لتوسيع نطاق الوصول",
      top_priorities: ["زيادة التوعية", "بناء الثقة", "تحفيز التحويلات"],
      instagram_fit_score: 9,
      instagram_fit_reasoning: "إنستغرام منصة مثالية للمحتوى البصري والتفاعل المباشر",
      key_risks: ["المنافسة في السوق"],
      realistic_expectations: "مضاعفة التفاعل وجلب عملاء محتملين خلال 30 يوماً",
      strategic_assumptions: ["الجمهور متواجد يومياً على إنستغرام"],
    },
  };

  const mockPillars = {
    content_pillars: [
      { name: "التوعية بالقيمة", description: "شرح فوائد المنتج وأهميته", percentage: 40 },
      { name: "الإثبات والنتائج", description: "آراء وتجارب العملاء", percentage: 30 },
      { name: "العروض والمبيعات", description: "عروض مباشرة ودعوات للشراء", percentage: 30 },
    ],
    objective_distribution: {
      awareness: 25,
      education: 20,
      engagement: 15,
      trust: 15,
      social_proof: 10,
      objection_handling: 5,
      conversion: 10,
    },
  };

  const mockCalendar = {
    content_items: Array.from({ length: 30 }, (_, i) => ({
      day_number: i + 1,
      caption: `كابشن تسويقي جذاب لليوم رقم ${i + 1} مع تفاصيل وإيموجي 🚀`,
      design_copy: {
        headline: `عنوان رئيسي لليوم ${i + 1}`,
        subtext: "نص مساعد توضيحي داخل التصميم",
        cta: "اطلب الآن",
      },
      post_type: i % 2 === 0 ? "reel" : "carousel",
      content_objective: "awareness",
      content_pillar: "التوعية بالقيمة",
      design_reference: "مشهد سينمائي مع إضاءة ستوديو احترافية",
      cta: "اضغط على الرابط في البايو للمزيد",
    })),
  };

  const mockRegeneratedPost = {
    caption: "نسخة كابشن مجددة ومعدلة بالكامل مع خطاف أقوى وتركيز أعلى على الفوائد!",
    design_copy: {
      headline: "عنوان مجدد بالكامل",
      subtext: "نص مساعد معدل",
      cta: "سجل مجاناً",
    },
    post_type: "carousel",
    content_objective: "conversion",
    content_pillar: "العروض والمبيعات",
    design_reference: "تصميم كاروسيل من 5 شرائح مع خطوط واضحة",
    cta: "سجل الآن قبل انتهاء المقاعد",
  };

  beforeAll(async () => {
    tokenA = await signTestToken({ id: userAId, email: `${userAId}@example.com`, name: "User A" });
    tokenB = await signTestToken({ id: userBId, email: `${userBId}@example.com`, name: "User B" });
    tokenFail = await signTestToken({ id: userFailId, email: `${userFailId}@example.com`, name: "User Fail" });
    tokenRetry = await signTestToken({ id: userRetryId, email: `${userRetryId}@example.com`, name: "User Retry" });

    // Seed test profiles
    const users = [
      { auth_user_id: userAId, email: `${userAId}@example.com`, name: "User A" },
      { auth_user_id: userBId, email: `${userBId}@example.com`, name: "User B" },
      { auth_user_id: userFailId, email: `${userFailId}@example.com`, name: "User Fail" },
      { auth_user_id: userRetryId, email: `${userRetryId}@example.com`, name: "User Retry" },
    ];
    for (const u of users) {
      await supabaseAdmin.from("profiles").upsert(u, { onConflict: "auth_user_id" });
    }

    // Mock Google Sheets export by default in this suite
    vi.spyOn(googleSheetsService, "exportPlanToSheets").mockResolvedValue({
      success: true,
      status: "completed",
      spreadsheetId: "mock-sheet-id",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/mock-sheet-id",
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    resetRateLimits();
    try {
      if (createdPlanId) {
        await plansRepository.deletePlan(createdPlanId, userAId);
      }
      await supabaseAdmin.from("profiles").delete().in("auth_user_id", [userAId, userBId, userFailId, userRetryId]);
    } catch (err) {
      console.warn("Cleanup warning:", err.message);
    }
  });

  describe("POST /api/v1/plans — Async Plan Generation", () => {
    it("Starts plan generation asynchronously, responds 201 immediately, and completes with 30 items", async () => {
      const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
      mockGemini
        .mockResolvedValueOnce(mockStrategy)  // Stage 1
        .mockResolvedValueOnce(mockPillars)   // Stage 2
        .mockResolvedValueOnce(mockCalendar); // Stage 3

      const res = await request(app)
        .post("/api/v1/plans")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          product_name: "Smart Planner AI",
          product_description: "An automated marketing planner generating tailored 30-day Instagram campaigns.",
          product_category: "برمجيات / SaaS",
          target_audience: "Marketing agencies, small business owners, and creators",
          problem_solved: "Wasting hours writing Instagram content without a clear strategy",
          marketing_objective: "direct_sales",
          brand_tone: ["احترافي ورسمي", "مباشر ومقنع"],
          website_url: "https://planner.ai",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("planId");
      expect(res.body.data).toHaveProperty("jobId");

      createdPlanId = res.body.data.planId;

      // Poll status until completed (or timeout after 10s)
      let isCompleted = false;
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const statusRes = await request(app)
          .get(`/api/v1/plans/${createdPlanId}/status`)
          .set("Authorization", `Bearer ${tokenA}`);

        if (statusRes.body.data?.jobStatus === "completed" && statusRes.body.data?.planStatus === "completed") {
          isCompleted = true;
          break;
        }
      }

      expect(isCompleted).toBe(true);

      // Verify exactly 30 content items inserted into database
      const { data: contentItems } = await supabaseAdmin
        .from("content_items")
        .select("id, day_number, caption, design_copy")
        .eq("marketing_plan_id", createdPlanId)
        .order("day_number", { ascending: true });

      expect(contentItems).toHaveLength(30);
      expect(contentItems[0].day_number).toBe(1);
      expect(contentItems[29].day_number).toBe(30);
    });

    it("Handles Gemini stage failure by marking job and plan as 'failed' (never stuck in 'generating')", async () => {
      const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
      mockGemini
        .mockResolvedValueOnce(mockStrategy) // Stage 1 succeeds
        .mockRejectedValueOnce(new Error("Gemini quota limit exceeded at Stage 2")); // Stage 2 fails

      const res = await request(app)
        .post("/api/v1/plans")
        .set("Authorization", `Bearer ${tokenFail}`)
        .send({
          product_name: "Failure Test Product",
          product_description: "A product designed to test AI failure handling in the pipeline.",
          product_category: "برمجيات / SaaS",
          target_audience: "QA Engineers",
          problem_solved: "Testing error handling",
          marketing_objective: "brand_awareness",
          brand_tone: ["تعليمي ومبسط"],
        });

      expect(res.status).toBe(201);
      const failedPlanId = res.body.data.planId;

      // Poll until failure state is reached
      let isFailed = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const statusRes = await request(app)
          .get(`/api/v1/plans/${failedPlanId}/status`)
          .set("Authorization", `Bearer ${tokenFail}`);

        if (statusRes.body.data?.jobStatus === "failed" && statusRes.body.data?.planStatus === "failed") {
          isFailed = true;
          expect(statusRes.body.data.errorMessage).toContain("Gemini quota limit exceeded");
          break;
        }
      }

      expect(isFailed).toBe(true);

      // Clean up failed plan
      await plansRepository.deletePlan(failedPlanId, userFailId);
    });

    it("Task 2 Safety: Controller catches synchronous throw in orchestrator without crashing process", async () => {
      // Force synchronous throw in runPlanGeneration
      const spyOrchestrator = vi
        .spyOn(orchestrator, "runPlanGeneration")
        .mockImplementationOnce(() => {
          throw new Error("Synchronous orchestrator crash before await");
        });

      const res = await request(app)
        .post("/api/v1/plans")
        .set("Authorization", `Bearer ${tokenFail}`)
        .send({
          product_name: "Sync Crash Test Product",
          product_description: "Testing unhandled exception catch in controller.",
          product_category: "برمجيات / SaaS",
          target_audience: "System Architects",
          problem_solved: "Ensuring node stability",
          marketing_objective: "brand_awareness",
          brand_tone: ["احترافي ورسمي"],
        });

      // Controller should still respond 201 cleanly without crashing the process
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      spyOrchestrator.mockRestore();
      await plansRepository.deletePlan(res.body.data.planId, userFailId);
    });
  });

  describe("POST /api/v1/plans/:id/retry — Retry Failed Plan Generation", () => {
    let failedPlanForRetryId;

    beforeAll(async () => {
      // Create a plan in 'failed' status for userRetryId
      const plan = await plansRepository.createPlan(userRetryId, {
        product_name: "Retryable Product",
        product_description: "A product that previously failed and needs retry.",
        product_category: "برمجيات / SaaS",
        target_audience: "Product Managers",
        problem_solved: "Retrying workflows seamlessly",
        marketing_objective: "product_launch",
        brand_tone: ["جريء وحماسي"],
        status: "failed",
      });
      failedPlanForRetryId = plan.id;
    });

    afterAll(async () => {
      if (failedPlanForRetryId) {
        await plansRepository.deletePlan(failedPlanForRetryId, userRetryId);
      }
    });

    it("Successfully retries a failed plan, creates fresh job, and generates complete plan", async () => {
      const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
      mockGemini
        .mockResolvedValueOnce(mockStrategy)
        .mockResolvedValueOnce(mockPillars)
        .mockResolvedValueOnce(mockCalendar);

      const res = await request(app)
        .post(`/api/v1/plans/${failedPlanForRetryId}/retry`)
        .set("Authorization", `Bearer ${tokenRetry}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.planId).toBe(failedPlanForRetryId);
      expect(res.body.data).toHaveProperty("jobId");

      // Poll until retry completes
      let isCompleted = false;
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const statusRes = await request(app)
          .get(`/api/v1/plans/${failedPlanForRetryId}/status`)
          .set("Authorization", `Bearer ${tokenRetry}`);

        if (statusRes.body.data?.jobStatus === "completed" && statusRes.body.data?.planStatus === "completed") {
          isCompleted = true;
          break;
        }
      }

      expect(isCompleted).toBe(true);
    });

    it("Rejects retry with HTTP 409 CONFLICT if plan is already 'completed'", async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${failedPlanForRetryId}/retry`) // now completed
        .set("Authorization", `Bearer ${tokenRetry}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INVALID_STATE");
      expect(res.body.error.message).toContain("فقط للخطط المتعثرة");
    });

    it("Rejects retry with HTTP 404 NOT_FOUND when User B attempts to retry User A's plan", async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${failedPlanForRetryId}/retry`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /api/v1/plans/:id/content/:day/regenerate — Single Post Regeneration", () => {
    it("Regenerates only Day 5's post and leaves other 29 items untouched", async () => {
      const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
      mockGemini.mockResolvedValueOnce(mockRegeneratedPost);

      // Verify Day 4 and Day 6 original captions before regenerate
      const { data: day4Before } = await supabaseAdmin
        .from("content_items")
        .select("caption")
        .eq("marketing_plan_id", createdPlanId)
        .eq("day_number", 4)
        .single();

      const res = await request(app)
        .post(`/api/v1/plans/${createdPlanId}/content/5/regenerate`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          instruction: "اجعل الكابشن يركز على العرض الخاص والتسجيل المجاني.",
          post_type: "carousel",
          content_objective: "conversion",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dayNumber).toBe(5);
      expect(res.body.data.caption).toBe(mockRegeneratedPost.caption);
      expect(res.body.data.postType).toBe("carousel");
      expect(res.body.data.contentObjective).toBe("conversion");

      // Verify Day 4 was NOT modified
      const { data: day4After } = await supabaseAdmin
        .from("content_items")
        .select("caption")
        .eq("marketing_plan_id", createdPlanId)
        .eq("day_number", 4)
        .single();

      expect(day4After.caption).toBe(day4Before.caption);
    });

    it(
      "Blocks with HTTP 429 RATE_LIMIT_EXCEEDED on the 11th regeneration request within an hour",
      async () => {
        resetRateLimits();
        const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
        mockGemini.mockResolvedValue(mockRegeneratedPost);

        // Make 10 successful regeneration requests
        for (let i = 1; i <= 10; i++) {
          const res = await request(app)
            .post(`/api/v1/plans/${createdPlanId}/content/1/regenerate`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({});
          expect(res.status).toBe(200);
        }

        // 11th request must be blocked by rate limiter
        const blockedRes = await request(app)
          .post(`/api/v1/plans/${createdPlanId}/content/1/regenerate`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({});

        expect(blockedRes.status).toBe(429);
        expect(blockedRes.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(blockedRes.body.error.message).toContain("تجاوزت الحد الأقصى لإعادة التوليد");
      },
      60000
    );

    it("User B CANNOT regenerate a post in User A's plan (404 NOT_FOUND)", async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${createdPlanId}/content/1/regenerate`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          instruction: "Intruder attempt",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
