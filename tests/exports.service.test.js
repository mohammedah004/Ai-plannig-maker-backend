import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import { geminiService } from "../src/services/ai/gemini.service.js";
import { googleSheetsService } from "../src/services/integrations/google-sheets.service.js";
import { plansRepository } from "../src/repositories/plans.repository.js";
import { exportsRepository } from "../src/repositories/exports.repository.js";

describe("Google Sheets & Drive Export Integration Tests (Phase 4)", () => {
  const userAId = "sheets-owner-a-" + Date.now();
  const userBId = "sheets-intruder-b-" + Date.now();

  let tokenA;
  let tokenB;

  const mockStrategy = {
    target_audience_analysis: "رواد أعمال وشركات",
    pain_points: ["قلة الوقت", "ضعف التفاعل"],
    desired_outcomes: ["زيادة المبيعات", "بناء هوية قوية"],
    positioning: "المنصة الذكية الرائدة لتخطيط المحتوى",
    messaging_angles: ["السرعة", "العائد العالي"],
    cta_strategy: "دعوة للتجربة المجانية",
    diagnosis: {
      marketing_maturity: "growing",
      maturity_reasoning: "منتج جاهز بحاجة لانتشار",
      top_priorities: ["التوعية", "الثقة"],
      instagram_fit_score: 9,
      instagram_fit_reasoning: "منصة مناسبة للمحتوى البصري",
      key_risks: ["المنافسة"],
      realistic_expectations: "زيادة التفاعل خلال 30 يوم",
      strategic_assumptions: ["الجمهور متفاعل يومياً"],
    },
  };

  const mockPillars = {
    content_pillars: [
      { name: "التوعية", description: "شرح الفوائد", percentage: 50 },
      { name: "التحويل", description: "عروض مباشرة", percentage: 50 },
    ],
    objective_distribution: {
      awareness: 30,
      education: 20,
      engagement: 20,
      trust: 10,
      social_proof: 10,
      objection_handling: 5,
      conversion: 5,
    },
  };

  const mockCalendar = {
    content_items: Array.from({ length: 30 }, (_, i) => ({
      day_number: i + 1,
      caption: `كابشن تجريبي لليوم ${i + 1}`,
      design_copy: { headline: `عنوان ${i + 1}`, subtext: "نص فرعي", cta: "اشترك" },
      post_type: "reel",
      content_objective: "awareness",
      content_pillar: "التوعية",
      design_reference: "مشهد واقعي",
      cta: "الرابط في البايو",
    })),
  };

  beforeAll(async () => {
    tokenA = await signTestToken({ id: userAId, email: `${userAId}@example.com`, name: "Sheets User A" });
    tokenB = await signTestToken({ id: userBId, email: `${userBId}@example.com`, name: "Sheets User B" });

    // Seed test profiles individually
    const users = [
      { auth_user_id: userAId, email: `${userAId}@example.com`, name: "Sheets User A" },
      { auth_user_id: userBId, email: `${userBId}@example.com`, name: "Sheets User B" },
    ];
    for (const u of users) {
      await supabaseAdmin.from("profiles").upsert(u, { onConflict: "auth_user_id" });
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await supabaseAdmin.from("profiles").delete().in("auth_user_id", [userAId, userBId]);
    } catch (err) {
      console.warn("Cleanup warning:", err.message);
    }
  });

  it("Full Plan Generation with Sheets Create + Append + Share all succeeding", async () => {
    const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
    mockGemini
      .mockResolvedValueOnce(mockStrategy)
      .mockResolvedValueOnce(mockPillars)
      .mockResolvedValueOnce(mockCalendar);

    const mockExport = vi.spyOn(googleSheetsService, "exportPlanToSheets");
    mockExport.mockResolvedValueOnce({
      success: true,
      status: "completed",
      isShared: true,
      spreadsheetId: "test-sheet-id-12345",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/test-sheet-id-12345",
    });

    const res = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        product_name: "Export Success Product",
        product_description: "Product for testing full sheets export flow.",
        product_category: "برمجيات / SaaS",
        target_audience: "Marketing Managers",
        problem_solved: "Automating content",
        marketing_objective: "brand_awareness",
        brand_tone: ["احترافي ورسمي"],
      });

    expect(res.status).toBe(201);
    const planId = res.body.data.planId;

    // Poll until export completes
    let isCompleted = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const statusRes = await request(app)
        .get(`/api/v1/plans/${planId}/status`)
        .set("Authorization", `Bearer ${tokenA}`);

      if (statusRes.body.data?.jobStatus === "completed" && statusRes.body.data?.exportStatus === "completed") {
        isCompleted = true;
        expect(statusRes.body.data.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/test-sheet-id-12345");
        break;
      }
    }

    expect(isCompleted).toBe(true);

    // Verify google_sheet_exports record in database
    const exportRecord = await exportsRepository.getExportByPlanId(planId, userAId);
    expect(exportRecord.status).toBe("completed");
    expect(exportRecord.spreadsheet_id).toBe("test-sheet-id-12345");
    expect(exportRecord.spreadsheet_url).toContain("test-sheet-id-12345");
    expect(exportRecord.error_message).toBeNull();

    await plansRepository.deletePlan(planId, userAId);
  });

  it("Drive share failure results in partial success (completed with warning message) without failing the plan", async () => {
    const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
    mockGemini
      .mockResolvedValueOnce(mockStrategy)
      .mockResolvedValueOnce(mockPillars)
      .mockResolvedValueOnce(mockCalendar);

    const mockExport = vi.spyOn(googleSheetsService, "exportPlanToSheets");
    mockExport.mockResolvedValueOnce({
      success: true,
      status: "completed",
      isShared: false,
      spreadsheetId: "test-sheet-unshared-999",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/test-sheet-unshared-999",
      errorMessage: "Drive permission denied for recipient domain",
    });

    const res = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        product_name: "Unshared Sheet Product",
        product_description: "Testing partial success when Drive share fails.",
        product_category: "برمجيات / SaaS",
        target_audience: "Marketing Teams",
        problem_solved: "Testing resilience",
        marketing_objective: "brand_awareness",
        brand_tone: ["ودود وقريب للقلب"],
      });

    expect(res.status).toBe(201);
    const planId = res.body.data.planId;

    // Poll status
    let reachedState = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const statusRes = await request(app)
        .get(`/api/v1/plans/${planId}/status`)
        .set("Authorization", `Bearer ${tokenA}`);

      if (statusRes.body.data?.jobStatus === "completed" && statusRes.body.data?.planStatus === "completed") {
        reachedState = true;
        expect(statusRes.body.data.exportStatus).toBe("completed");
        expect(statusRes.body.data.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/test-sheet-unshared-999");
        expect(statusRes.body.data.exportErrorMessage).toContain("Drive permission denied");
        break;
      }
    }

    expect(reachedState).toBe(true);

    // Verify plan status in DB is completed
    const plan = await plansRepository.getPlanById(planId, userAId);
    expect(plan.status).toBe("completed");

    await plansRepository.deletePlan(planId, userAId);
  });

  it("Total Sheets export failure marks export as 'failed' but leaves plan and job 'completed'", async () => {
    const mockGemini = vi.spyOn(geminiService, "generateStructuredJSON");
    mockGemini
      .mockResolvedValueOnce(mockStrategy)
      .mockResolvedValueOnce(mockPillars)
      .mockResolvedValueOnce(mockCalendar);

    const mockExport = vi.spyOn(googleSheetsService, "exportPlanToSheets");
    mockExport.mockResolvedValueOnce({
      success: false,
      status: "failed",
      isShared: false,
      errorMessage: "Google Sheets API quota exceeded (429)",
    });

    const res = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        product_name: "Total Export Failure Product",
        product_description: "Testing total failure of sheets export.",
        product_category: "برمجيات / SaaS",
        target_audience: "Marketing Teams",
        problem_solved: "Testing resilience",
        marketing_objective: "brand_awareness",
        brand_tone: ["ودود وقريب للقلب"],
      });

    expect(res.status).toBe(201);
    const planId = res.body.data.planId;

    // Poll status
    let reachedState = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const statusRes = await request(app)
        .get(`/api/v1/plans/${planId}/status`)
        .set("Authorization", `Bearer ${tokenA}`);

      if (statusRes.body.data?.jobStatus === "completed" && statusRes.body.data?.planStatus === "completed") {
        reachedState = true;
        expect(statusRes.body.data.exportStatus).toBe("failed");
        expect(statusRes.body.data.spreadsheetUrl).toBeNull();
        break;
      }
    }

    expect(reachedState).toBe(true);

    // Verify plan is still completed
    const plan = await plansRepository.getPlanById(planId, userAId);
    expect(plan.status).toBe("completed");

    // Clean up
    await plansRepository.deletePlan(planId, userAId);
  });

  describe("POST /api/v1/plans/:id/retry-export — Retry Google Sheets Export", () => {
    let completedPlanWithFailedExportId;
    let partialSuccessPlanId;

    beforeAll(async () => {
      // 1. Create a completed plan with failed export
      const planFail = await plansRepository.createPlan(userAId, {
        product_name: "Retry Export Product",
        product_description: "Product for testing export retry endpoint.",
        product_category: "برمجيات / SaaS",
        target_audience: "CTOs",
        problem_solved: "Export retry testing",
        marketing_objective: "direct_sales",
        brand_tone: ["احترافي ورسمي"],
        status: "completed",
      });

      completedPlanWithFailedExportId = planFail.id;

      // Insert 30 content items
      const itemsToInsert = Array.from({ length: 30 }, (_, i) => ({
        marketing_plan_id: planFail.id,
        user_id: userAId,
        day_number: i + 1,
        caption: `كابشن لليوم ${i + 1}`,
        design_copy: { headline: `عنوان ${i + 1}` },
        post_type: "reel",
        content_objective: "awareness",
        content_pillar: "الأساس",
        design_reference: "مرجع بصري",
        cta: "دعوة للشراء",
      }));
      await supabaseAdmin.from("content_items").insert(itemsToInsert);

      // Insert a failed export record
      await exportsRepository.createExport(planFail.id, userAId);
      await exportsRepository.updateExportStatus(planFail.id, "failed", {
        errorMessage: "Initial export failed",
      });

      // 2. Create a completed plan with partial success (completed WITH error_message)
      const planPartial = await plansRepository.createPlan(userAId, {
        product_name: "Partial Export Product",
        product_description: "Product with unshared sheet for retry testing.",
        product_category: "برمجيات / SaaS",
        target_audience: "Founders",
        problem_solved: "Partial export testing",
        marketing_objective: "direct_sales",
        brand_tone: ["ودود وقريب للقلب"],
        status: "completed",
      });

      partialSuccessPlanId = planPartial.id;

      const partialItems = Array.from({ length: 30 }, (_, i) => ({
        marketing_plan_id: planPartial.id,
        user_id: userAId,
        day_number: i + 1,
        caption: `كابشن جزئي لليوم ${i + 1}`,
        design_copy: { headline: `عنوان جزئي ${i + 1}` },
        post_type: "carousel",
        content_objective: "conversion",
        content_pillar: "المبيعات",
        design_reference: "مرجع بصري",
        cta: "سجل الآن",
      }));
      await supabaseAdmin.from("content_items").insert(partialItems);

      // Insert export record with status 'completed' and non-null error_message (unshared)
      await exportsRepository.createExport(planPartial.id, userAId);
      await exportsRepository.updateExportStatus(planPartial.id, "completed", {
        spreadsheetId: "existing-partial-sheet-888",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/existing-partial-sheet-888",
        errorMessage: "Drive permission denied initially",
      });
    });

    afterAll(async () => {
      if (completedPlanWithFailedExportId) {
        await plansRepository.deletePlan(completedPlanWithFailedExportId, userAId);
      }
      if (partialSuccessPlanId) {
        await plansRepository.deletePlan(partialSuccessPlanId, userAId);
      }
    });

    it("Successfully retries export from 'failed' status and updates google_sheet_exports to 'completed'", async () => {
      const mockExport = vi.spyOn(googleSheetsService, "exportPlanToSheets");
      mockExport.mockResolvedValueOnce({
        success: true,
        status: "completed",
        isShared: true,
        spreadsheetId: "retried-sheet-id-777",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/retried-sheet-id-777",
      });

      const res = await request(app)
        .post(`/api/v1/plans/${completedPlanWithFailedExportId}/retry-export`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("completed");
      expect(res.body.data.spreadsheetId).toBe("retried-sheet-id-777");
      expect(res.body.data.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/retried-sheet-id-777");

      // Verify DB record
      const exportData = await exportsRepository.getExportByPlanId(completedPlanWithFailedExportId, userAId);
      expect(exportData.status).toBe("completed");
      expect(exportData.error_message).toBeNull();
    });

    it("Partial success retry: allows retry-export (200, NOT 409) when status is 'completed' with non-null error_message, reusing existing spreadsheetId", async () => {
      const mockExport = vi.spyOn(googleSheetsService, "exportPlanToSheets");
      mockExport.mockImplementationOnce(async ({ existingSpreadsheetId }) => {
        // Assert that the existing spreadsheetId is reused without recreating
        expect(existingSpreadsheetId).toBe("existing-partial-sheet-888");
        return {
          success: true,
          status: "completed",
          isShared: true,
          spreadsheetId: existingSpreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}`,
        };
      });

      const res = await request(app)
        .post(`/api/v1/plans/${partialSuccessPlanId}/retry-export`)
        .set("Authorization", `Bearer ${tokenA}`);

      // Must succeed (200, not blocked by 409)
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("completed");
      expect(res.body.data.spreadsheetId).toBe("existing-partial-sheet-888");

      // Verify DB record has cleared error_message
      const exportData = await exportsRepository.getExportByPlanId(partialSuccessPlanId, userAId);
      expect(exportData.status).toBe("completed");
      expect(exportData.error_message).toBeNull();
    });

    it("Rejects retry-export with HTTP 409 if export is ALREADY fully completed (status 'completed' and error_message is null)", async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${completedPlanWithFailedExportId}/retry-export`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_COMPLETED");
    });

    it("User B CANNOT retry-export on User A's plan (404 NOT_FOUND)", async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${completedPlanWithFailedExportId}/retry-export`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
