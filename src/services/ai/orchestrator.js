import { geminiService } from "./gemini.service.js";
import { buildStrategyPrompt, buildPillarsPrompt, buildCalendarPrompt } from "./prompts.js";
import { strategySchema, pillarsSchema, calendarSchema } from "./schemas.js";
import { plansRepository } from "../../repositories/plans.repository.js";
import { jobsRepository } from "../../repositories/jobs.repository.js";
import { exportsRepository } from "../../repositories/exports.repository.js";
import { googleSheetsService } from "../integrations/google-sheets.service.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { logger } from "../../utils/logger.js";

/**
 * 3-Stage AI Marketing Plan Generation & Google Sheets Export Orchestrator
 */
export class AIOrchestrator {
  /**
   * Executes the full 3-stage marketing plan generation and subsequent Google Sheets export.
   *
   * @param {Object} params
   * @param {string} params.planId - UUID of the marketing plan
   * @param {string} params.userId - Canonical user ID of the owner
   * @param {string} params.jobId - UUID of the generation job
   * @param {Object} params.planInput - Plan creation form data
   * @param {Object|null} [params.previousPlanSummary=null] - Previous plan strategic summary
   */
  async runPlanGeneration({ planId, userId, jobId, planInput, previousPlanSummary = null }) {
    logger.info({ planId, userId, jobId }, "[Orchestrator] Starting 3-stage plan generation pipeline");

    let normalizedItems = [];

    try {
      // -------------------------------------------------------------
      // STAGE 1: Strategy & Business Diagnosis
      // -------------------------------------------------------------
      logger.info({ planId, jobId }, "[Orchestrator] Stage 1: Generating Strategy & Diagnosis...");
      await jobsRepository.updateJobStatus(
        jobId,
        "generating_strategy",
        "جاري تحليل السوق والجمهور وبناء التموضع الاستراتيجي..."
      );

      const stage1Prompts = buildStrategyPrompt(planInput, previousPlanSummary);
      const stage1Raw = await geminiService.generateStructuredJSON({
        systemPrompt: stage1Prompts.systemPrompt,
        userPrompt: stage1Prompts.userPrompt,
        temperature: 0.7,
      });

      const strategy = strategySchema.parse(stage1Raw);

      // -------------------------------------------------------------
      // STAGE 2: Content Pillars & Objective Distribution
      // -------------------------------------------------------------
      logger.info({ planId, jobId }, "[Orchestrator] Stage 2: Generating Content Pillars & Distribution...");
      await jobsRepository.updateJobStatus(
        jobId,
        "generating_pillars",
        "جاري تحديد ركائز المحتوى وهندسة توزيع الأهداف التسويقية..."
      );

      const stage2Prompts = buildPillarsPrompt(planInput, strategy);
      const stage2Raw = await geminiService.generateStructuredJSON({
        systemPrompt: stage2Prompts.systemPrompt,
        userPrompt: stage2Prompts.userPrompt,
        temperature: 0.7,
      });

      const pillars = pillarsSchema.parse(stage2Raw);

      // -------------------------------------------------------------
      // STAGE 3: 30-Day Content Calendar
      // -------------------------------------------------------------
      logger.info({ planId, jobId }, "[Orchestrator] Stage 3: Generating 30-Day Content Calendar...");
      await jobsRepository.updateJobStatus(
        jobId,
        "generating_content",
        "جاري صياغة تقويم الـ 30 يوماً وتجهيز الكابشن والتوجيهات البصرية..."
      );

      const stage3Prompts = buildCalendarPrompt(planInput, strategy, pillars);
      const stage3Raw = await geminiService.generateStructuredJSON({
        systemPrompt: stage3Prompts.systemPrompt,
        userPrompt: stage3Prompts.userPrompt,
        temperature: 0.7,
      });

      // Normalize stage3Raw before parsing if Gemini returned raw Array or wrapped under alternative keys
      let rawCalendar = stage3Raw;
      if (Array.isArray(rawCalendar)) {
        rawCalendar = { content_items: rawCalendar };
      } else if (rawCalendar && typeof rawCalendar === "object" && !Array.isArray(rawCalendar.content_items)) {
        const alt = rawCalendar.calendar || rawCalendar.items || rawCalendar.posts || rawCalendar.contentItems || rawCalendar.days;
        if (Array.isArray(alt)) {
          rawCalendar = { content_items: alt };
        }
      }

      const calendar = calendarSchema.parse(rawCalendar);

      // Ensure we have exactly 30 items and contiguous 1..30 day numbers
      let itemsList = Array.isArray(calendar.content_items) ? calendar.content_items : [];
      if (itemsList.length !== 30) {
        logger.warn(
          { planId, receivedCount: itemsList.length },
          "[Orchestrator] Content items count not 30, adjusting indices..."
        );
      }
      normalizedItems = itemsList.slice(0, 30).map((item, idx) => ({
        ...item,
        day_number: idx + 1,
      }));

      // -------------------------------------------------------------
      // ATOMIC COMPLETION (Supabase RPC)
      // -------------------------------------------------------------
      logger.info({ planId, jobId }, "[Orchestrator] Saving complete plan atomically via RPC...");
      await plansRepository.completePlan({
        planId,
        userId,
        strategy,
        contentPillars: pillars.content_pillars,
        objectiveDistribution: pillars.objective_distribution,
        contentItems: normalizedItems,
        jobId,
      });

      logger.info({ planId, jobId }, "🎉 [Orchestrator] Marketing plan generated and saved successfully!");
    } catch (err) {
      logger.error(
        { planId, jobId, error: err.message, stack: err.stack },
        "💥 [Orchestrator] Plan generation pipeline failed"
      );

      const userErrorMessage = err.message || "فشلت عملية التوليد بالذكاء الاصطناعي.";

      // Update generation job to failed
      try {
        await jobsRepository.updateJobStatus(jobId, "failed", "تعثرت عملية التوليد", userErrorMessage);
      } catch (jobErr) {
        logger.error({ jobErr: jobErr.message }, "Failed to update job status to failed");
      }

      // Update marketing plan status to failed
      try {
        await supabaseAdmin
          .from("marketing_plans")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", planId)
          .eq("user_id", String(userId));
      } catch (planErr) {
        logger.error({ planErr: planErr.message }, "Failed to update plan status to failed");
      }

      // Re-throw to trigger any top-level catch handler
      throw err;
    }

    // -----------------------------------------------------------------
    // PHASE 4: GOOGLE SHEETS & DRIVE EXPORT (NON-BLOCKING FOR PLAN SUCCESS)
    // -----------------------------------------------------------------
    try {
      logger.info({ planId, jobId }, "[Orchestrator] Starting Google Sheets export step...");
      await jobsRepository.updateJobStatus(
        jobId,
        "exporting_sheet",
        "جاري إنشاء وتصدير جدول المحتوى إلى Google Sheets..."
      );

      // Fetch owner email from profiles table
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("auth_user_id", String(userId))
        .maybeSingle();

      const userEmail = userProfile?.email || null;

      const exportResult = await googleSheetsService.exportPlanToSheets({
        productName: planInput.product_name,
        userEmail,
        contentItems: normalizedItems,
        userId,
      });

      if (exportResult.status === "completed") {
        await exportsRepository.updateExportStatus(planId, "completed", {
          spreadsheetId: exportResult.spreadsheetId,
          spreadsheetUrl: exportResult.spreadsheetUrl,
          errorMessage: exportResult.isShared ? null : exportResult.errorMessage,
          targetVersion: 1,
          exportedVersion: 1,
        });

        await jobsRepository.updateJobStatus(
          jobId,
          "completed",
          exportResult.isShared
            ? "تم توليد الخطة وتصدير Google Sheet بنجاح!"
            : "تم توليد الخطة وجدول البيانات (تعذرت المشاركة المباشرة مع البريد)."
        );

        logger.info(
          { planId, spreadsheetUrl: exportResult.spreadsheetUrl, isShared: exportResult.isShared },
          "✅ [Orchestrator] Google Sheets export step completed successfully"
        );
      } else {
        await exportsRepository.updateExportStatus(planId, "failed", {
          errorMessage: exportResult.errorMessage,
        });
        await jobsRepository.updateJobStatus(
          jobId,
          "completed",
          "تم توليد الخطة بنجاح (تعذر تصدير Google Sheet)."
        );
        logger.error(
          { planId, error: exportResult.errorMessage },
          "❌ [Orchestrator] Google Sheets export failed completely"
        );
      }
    } catch (exportErr) {
      logger.error(
        { planId, error: exportErr.message },
        "[Orchestrator] Unexpected exception during Google Sheets export step"
      );
      try {
        await exportsRepository.updateExportStatus(planId, "failed", {
          errorMessage: exportErr.message || "تعذر إكمال التصدير إلى Google Sheets.",
        });
        await jobsRepository.updateJobStatus(
          jobId,
          "completed",
          "تم توليد الخطة بنجاح (تعذر تصدير Google Sheet)."
        );
      } catch (err) {
        logger.error({ err: err.message }, "Failed to update export failure status");
      }
    }

    return { success: true };
  }
}

export const orchestrator = new AIOrchestrator();
