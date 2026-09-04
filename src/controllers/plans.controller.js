import { plansRepository } from "../repositories/plans.repository.js";
import { jobsRepository } from "../repositories/jobs.repository.js";
import { exportsRepository } from "../repositories/exports.repository.js";
import { supabaseAdmin } from "../config/supabase.js";
import { orchestrator } from "../services/ai/orchestrator.js";
import { geminiService } from "../services/ai/gemini.service.js";
import { googleSheetsService } from "../services/integrations/google-sheets.service.js";
import { buildRegeneratePrompt } from "../services/ai/prompts.js";
import { singlePostRegenerationSchema } from "../services/ai/schemas.js";
import { checkRateLimit } from "../utils/rate-limiter.js";
import { resolveQuota, getNextUTCDayReset } from "../utils/quota-policy.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { NotFoundError, ValidationError, RateLimitError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import {
  externalAiSingleDayContractSchema,
  externalAiMultiDayContractSchema,
} from "../schemas/external-ai.schema.js";
import { buildStrictScopedOutputSchema } from "../schemas/scoped-ai.schema.js";
import { calculateStrategicImpactForChangeSet } from "../services/ai/strategy-impact.js";

/**
 * Plans Controller
 */
export class PlansController {
  /**
   * GET /api/v1/plans
   * Lists all marketing plans for the authenticated user
   */
  async getPlans(req, res, next) {
    try {
      const plans = await plansRepository.getPlansByUser(req.user.userId);
      return sendSuccess(res, plans);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/plans/:id
   * Retrieves single marketing plan by ID verifying ownership
   */
  async getPlanById(req, res, next) {
    try {
      const plan = await plansRepository.getPlanById(req.params.id, req.user.userId);
      if (!plan) {
        throw new NotFoundError("الخطة غير موجودة أو ليس لديك صلاحية الوصول إليها.");
      }
      return sendSuccess(res, plan);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/plans/:id/status
   * Polling endpoint to check live generation job and export status
   */
  async getPlanStatus(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.userId;

      // 1. Verify plan ownership & status
      const { data: plan, error: planErr } = await supabaseAdmin
        .from("marketing_plans")
        .select("id, status")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planErr || !plan) {
        throw new NotFoundError("الخطة غير موجودة أو لا تملك صلاحية الوصول إليها.");
      }

      // 2. Fetch generation job status
      const job = await jobsRepository.getJobByPlanId(planId, userId);

      // 3. Fetch export status
      const exportData = await exportsRepository.getExportByPlanId(planId, userId);

      return sendSuccess(res, {
        planId,
        planStatus: plan.status,
        jobStatus: job?.status || "queued",
        currentStep: job?.current_step || "في انتظار بدء التوليد...",
        errorMessage: job?.error_message || null,
        exportStatus: exportData?.status || "pending",
        spreadsheetUrl: exportData?.spreadsheet_url || null,
        spreadsheetId: exportData?.spreadsheet_id || null,
        exportErrorMessage: exportData?.error_message || null,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/plans/:id
   * Deletes a plan and all its cascading records
   */
  async deletePlan(req, res, next) {
    try {
      const deleted = await plansRepository.deletePlan(req.params.id, req.user.userId);
      if (!deleted) {
        throw new NotFoundError("الخطة غير موجودة أو ليس لديك صلاحية حذفها.");
      }
      return sendSuccess(res, null, 200, "تم حذف الخطة وجميع بياناتها بنجاح.");
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/plans
   * Asynchronous Plan Generation Trigger (responds immediately with { planId, jobId })
   */
  async createPlan(req, res, next) {
    try {
      const userId = req.user.userId;
      const userRole = req.user.role || "user";
      const planInput = req.body;

      // 1. Resolve Quota Policy for the authenticated user
      const quotaPolicy = resolveQuota(userRole);

      // 2. Fetch Brand Memory from previous plan (if brand_profile_id provided)
      let previousPlanSummary = null;
      if (planInput.brand_profile_id) {
        const { data: prevPlan } = await supabaseAdmin
          .from("marketing_plans")
          .select("marketing_objective, content_pillars, strategy")
          .eq("brand_profile_id", planInput.brand_profile_id)
          .eq("user_id", userId)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevPlan) {
          previousPlanSummary = {
            previous_objective: prevPlan.marketing_objective,
            previous_pillars: Array.isArray(prevPlan.content_pillars)
              ? prevPlan.content_pillars.map((p) => p.name || p)
              : [],
            previous_strategy_highlights: prevPlan.strategy?.positioning || null,
          };
        }
      }

      // 3. Atomically check concurrency lock, check daily quota, and create plan + job via Supabase RPC
      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
        "create_plan_with_quota_check",
        {
          p_user_id: String(userId),
          p_daily_limit: quotaPolicy.dailyLimit, // null = unlimited (admin)
          p_product_name: planInput.product_name,
          p_product_description: planInput.product_description,
          p_product_category: planInput.product_category,
          p_target_audience: planInput.target_audience,
          p_problem_solved: planInput.problem_solved,
          p_marketing_objective: planInput.marketing_objective,
          p_brand_tone: Array.isArray(planInput.brand_tone) ? planInput.brand_tone : [],
          p_website_url: planInput.website_url || null,
          p_additional_context: planInput.additional_context || null,
          p_brand_profile_id: planInput.brand_profile_id || null,
        }
      );

      if (rpcError) {
        logger.error({ err: rpcError, userId }, "[PlansController] RPC create_plan_with_quota_check failed");
        throw new Error("تعذر إنشاء سجل الخطة في قاعدة البيانات عبر الإجراء الذري.");
      }

      // 4. Handle RPC specific business responses
      if (rpcResult?.error === "JOB_IN_PROGRESS") {
        return sendError(
          res,
          "JOB_IN_PROGRESS",
          "لديك خطة تسويقية قيد التوليد حالياً. يرجى الانتظار حتى تكتمل.",
          409
        );
      }

      if (rpcResult?.error === "QUOTA_EXCEEDED") {
        return sendError(
          res,
          "QUOTA_EXCEEDED",
          "لقد استنفدت حصتك اليومية لإنشاء الخطط (خطة واحدة يومياً). ستتجدد الحصة غداً.",
          429,
          {
            used: rpcResult.used,
            limit: rpcResult.limit,
            resetsAt: getNextUTCDayReset(),
          }
        );
      }

      const planId = rpcResult?.planId;
      const jobId = rpcResult?.jobId;

      if (!planId || !jobId) {
        throw new Error("استجابة غير صالحة من نظام إنشاء الخطة وقفل الكوتا.");
      }

      // 5. Create google_sheet_exports placeholder record (status: 'pending')
      await exportsRepository.createExport(planId, userId);

      logger.info(
        { planId, userId, jobId, productName: planInput.product_name, role: userRole },
        `[INFO] Received plan generation job: ${jobId} (Role: ${userRole})`
      );

      // 6. Fire-and-forget background execution safely wrapped in Promise.resolve() with backstop catch
      Promise.resolve()
        .then(() =>
          orchestrator.runPlanGeneration({
            planId,
            userId,
            jobId,
            planInput,
            previousPlanSummary,
          })
        )
        .catch(async (err) => {
          logger.error(
            { err: err.message, stack: err.stack, planId, jobId },
            "Unhandled error escaped plan generation orchestrator"
          );

          // Best-effort recovery: mark job & plan failed if orchestrator threw before catching
          try {
            await jobsRepository.updateJobStatus(
              jobId,
              "failed",
              "تعثرت عملية التوليد",
              err.message || "Unhandled server exception"
            );
            await supabaseAdmin
              .from("marketing_plans")
              .update({ status: "failed", updated_at: new Date().toISOString() })
              .eq("id", planId);
          } catch (dbErr) {
            logger.error({ dbErr: dbErr.message }, "Failed best-effort error recording in catch");
          }
        });

      // 7. Respond fast with 201 Created
      return sendSuccess(
        res,
        {
          planId,
          jobId,
        },
        201,
        "تم بدء توليد الخطة التسويقية بنجاح."
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/plans/:id/retry
   * Retries plan generation for a failed plan, creating a fresh job record.
   *
   * ARCHITECTURAL DECISION / EDGE CASE:
   * A plan that failed on day T and is retried successfully on day T+1 retains its original `created_at`
   * timestamp (day T). Under the daily quota calculation (counting `marketing_plans` where `status = 'completed'`
   * and `created_at >= today_start_utc`), this retried plan does NOT consume day T+1's quota.
   * This is an intentional MVP design decision: the user requested the plan on day T, suffered a technical failure,
   * and is rightfully redeeming their day T quota without being penalized on day T+1.
   */
  async retryPlan(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.userId;

      // 1. Fetch Plan & Verify Ownership
      const { data: plan, error: planErr } = await supabaseAdmin
        .from("marketing_plans")
        .select("*")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planErr || !plan) {
        throw new NotFoundError("الخطة غير موجودة أو لا تملك صلاحية الوصول إليها.");
      }

      // 2. State Validation: Can only retry plans with status 'failed'
      if (plan.status !== "failed") {
        return sendError(
          res,
          "INVALID_STATE",
          `يمكن إعادة المحاولة فقط للخطط المتعثرة (failed). حالة الخطة الحالية: ${plan.status}`,
          409
        );
      }

      // 3. Reset plan status to 'generating'
      await supabaseAdmin
        .from("marketing_plans")
        .update({
          status: "generating",
          updated_at: new Date().toISOString(),
        })
        .eq("id", planId)
        .eq("user_id", userId);

      // 4. Create a fresh generation_jobs row (status 'queued') to preserve job history
      const newJob = await jobsRepository.createJob(planId, userId);

      // 5. Look up previous plan summary if brand_profile_id exists
      let previousPlanSummary = null;
      if (plan.brand_profile_id) {
        const { data: prevPlan } = await supabaseAdmin
          .from("marketing_plans")
          .select("marketing_objective, content_pillars, strategy")
          .eq("brand_profile_id", plan.brand_profile_id)
          .eq("user_id", userId)
          .eq("status", "completed")
          .neq("id", planId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevPlan) {
          previousPlanSummary = {
            previous_objective: prevPlan.marketing_objective,
            previous_pillars: Array.isArray(prevPlan.content_pillars)
              ? prevPlan.content_pillars.map((p) => p.name || p)
              : [],
            previous_strategy_highlights: prevPlan.strategy?.positioning || null,
          };
        }
      }

      // Reconstruct plan input from plan record
      const planInput = {
        product_name: plan.product_name,
        product_description: plan.product_description,
        product_category: plan.product_category,
        target_audience: plan.target_audience,
        problem_solved: plan.problem_solved,
        marketing_objective: plan.marketing_objective,
        brand_tone: plan.brand_tone,
        website_url: plan.website_url,
        additional_context: plan.additional_context,
        brand_profile_id: plan.brand_profile_id,
      };

      // 6. Fire-and-forget background execution safely wrapped in Promise.resolve()
      Promise.resolve()
        .then(() =>
          orchestrator.runPlanGeneration({
            planId,
            userId,
            jobId: newJob.id,
            planInput,
            previousPlanSummary,
          })
        )
        .catch(async (err) => {
          logger.error(
            { err: err.message, stack: err.stack, planId, jobId: newJob.id },
            "Unhandled error escaped retry plan generation orchestrator"
          );

          try {
            await jobsRepository.updateJobStatus(
              newJob.id,
              "failed",
              "تعثرت عملية إعادة المحاولة",
              err.message || "Unhandled server exception"
            );
            await supabaseAdmin
              .from("marketing_plans")
              .update({ status: "failed", updated_at: new Date().toISOString() })
              .eq("id", planId);
          } catch (dbErr) {
            logger.error({ dbErr: dbErr.message }, "Failed best-effort retry error recording in catch");
          }
        });

      // 7. Respond 200 with new job details
      return sendSuccess(
        res,
        {
          planId,
          jobId: newJob.id,
        },
        200,
        "تمت إعادة محاولة توليد الخطة بنجاح."
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/plans/:id/retry-export
   * Retries Google Sheets & Drive export for a completed plan
   */
  async retryExport(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.userId;

      // 1. Verify Plan Ownership & Completed State
      const { data: plan, error: planErr } = await supabaseAdmin
        .from("marketing_plans")
        .select("id, product_name, status, content_version")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planErr || !plan) {
        throw new NotFoundError("الخطة غير موجودة أو لا تملك صلاحية الوصول إليها.");
      }

      if (plan.status !== "completed") {
        return sendError(
          res,
          "INVALID_STATE",
          `لا يمكن إعادة تصدير جدول البيانات إلا بعد اكتمال توليد الخطة التسويقية. حالة الخطة الحالية: ${plan.status}`,
          409
        );
      }

      const planContentVersion = plan.content_version || 1;

      // 2. Fetch Export Record
      const exportRecord = await exportsRepository.getExportByPlanId(planId, userId);
      if (
        exportRecord &&
        exportRecord.status === "completed" &&
        !exportRecord.error_message &&
        (!exportRecord.exported_version || exportRecord.exported_version === planContentVersion)
      ) {
        return sendError(
          res,
          "ALREADY_COMPLETED",
          "تم تصدير جدول البيانات بنجاح مسبقاً وتوجد مشاركة نشطة بالفعل.",
          409
        );
      }

      // 3. Fetch Content Items
      const { data: contentItems, error: itemsErr } = await supabaseAdmin
        .from("content_items")
        .select("*")
        .eq("marketing_plan_id", planId)
        .order("day_number", { ascending: true });

      if (itemsErr || !contentItems || contentItems.length === 0) {
        throw new ValidationError("لم يتم العثور على عناصر محتوى لتصديرها في هذه الخطة.");
      }

      // 4. Synchronize via unified sync pipeline
      const syncResult = await googleSheetsService.syncPlanToGoogleSheet(planId, plan.content_version);

      if (syncResult.success) {
        return sendSuccess(
          res,
          {
            planId,
            status: "completed",
            isShared: true,
            spreadsheetId: syncResult.spreadsheetId,
            spreadsheetUrl: syncResult.spreadsheetUrl,
            warning: null,
          },
          200,
          "تم تصدير ومزامنة جدول البيانات في Google Sheets بنجاح!"
        );
      } else {
        return sendError(
          res,
          "EXPORT_FAILED",
          syncResult.errorMessage || "فشل تصدير جدول البيانات إلى Google Sheets.",
          500
        );
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/plans/:id/content/:day/regenerate
   * Regenerates a single day's post while preserving strategic context
   */
  async regeneratePost(req, res, next) {
    try {
      const { id: planId, day: rawDay } = req.params;
      const userId = req.user.userId;
      const dayNumber = parseInt(rawDay, 10);

      if (isNaN(dayNumber) || dayNumber < 1 || dayNumber > 30) {
        throw new ValidationError("رقم اليوم يجب أن يكون بين 1 و 30.");
      }

      // 1. Rate Limiting Check (Max 10 per hour per user)
      const rateLimit = checkRateLimit(userId, 10, 60 * 60 * 1000);
      if (!rateLimit.allowed) {
        throw new RateLimitError(
          `لقد تجاوزت الحد الأقصى لإعادة التوليد (10 مرات في الساعة). يرجى الانتظار ${rateLimit.resetMinutes} دقيقة قبل المحاولة مجدداً.`
        );
      }

      const { instruction, post_type, content_objective } = req.body;

      // 2. Fetch Parent Plan & Verify Ownership
      const { data: plan, error: planError } = await supabaseAdmin
        .from("marketing_plans")
        .select("id, product_name, product_description, product_category, target_audience, problem_solved, brand_tone, website_url, strategy, content_pillars")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planError || !plan) {
        throw new NotFoundError("الخطة غير موجودة أو لا تملك صلاحية التعديل.");
      }

      // 3. Fetch Current Content Item
      const { data: currentItem, error: itemError } = await supabaseAdmin
        .from("content_items")
        .select("*")
        .eq("marketing_plan_id", planId)
        .eq("day_number", dayNumber)
        .eq("user_id", userId)
        .maybeSingle();

      if (itemError || !currentItem) {
        throw new NotFoundError(`منشور اليوم ${dayNumber} غير موجود في هذه الخطة.`);
      }

      // 4. Build Regeneration Prompts and call Gemini
      const prompts = buildRegeneratePrompt({
        plan,
        currentItem,
        dayNumber,
        instruction,
        requestedPostType: post_type,
        requestedObjective: content_objective,
      });

      const aiRaw = await geminiService.generateStructuredJSON({
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        temperature: 0.7,
      });

      const generated = singlePostRegenerationSchema.parse(aiRaw);

      // 5. Update the single row in content_items table
      const updatePayload = {
        caption: generated.caption,
        design_copy: generated.design_copy,
        post_type: generated.post_type,
        content_objective: generated.content_objective,
        content_pillar: generated.content_pillar,
        design_reference: generated.design_reference,
        cta: generated.cta,
        updated_at: new Date().toISOString(),
      };

      const { data: updatedRow, error: updateError } = await supabaseAdmin
        .from("content_items")
        .update(updatePayload)
        .eq("id", currentItem.id)
        .eq("marketing_plan_id", planId)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateError || !updatedRow) {
        throw new Error("تعذر حفظ تعديلات المنشور في قاعدة البيانات.");
      }

      // Bump plan content_version and trigger background sync
      const nextVersion = (plan.content_version || 1) + 1;
      await supabaseAdmin
        .from("marketing_plans")
        .update({ content_version: nextVersion, updated_at: new Date().toISOString() })
        .eq("id", planId);

      googleSheetsService.syncPlanToGoogleSheet(planId, nextVersion).catch((syncErr) => {
        logger.error({ syncErr: syncErr.message, planId }, "[PlansController.regeneratePost] Background sync error");
      });

      return sendSuccess(
        res,
        {
          id: updatedRow.id,
          dayNumber: updatedRow.day_number,
          caption: updatedRow.caption,
          designCopy: updatedRow.design_copy,
          postType: updatedRow.post_type,
          contentObjective: updatedRow.content_objective,
          contentPillar: updatedRow.content_pillar,
          designReference: updatedRow.design_reference,
          cta: updatedRow.cta,
          updatedAt: updatedRow.updated_at,
          remaining: rateLimit.remaining,
        },
        200,
        `تمت إعادة صياغة منشور اليوم ${dayNumber} بنجاح!`
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/plans/quota
   * Retrieves current daily generation quota and role details for the authenticated user
   */
  async getQuotaStatus(req, res, next) {
    try {
      const userId = req.user.userId;
      const userRole = req.user.role || "user";
      const policy = resolveQuota(userRole);

      // Admin has unlimited quota
      if (policy.dailyLimit === null) {
        return sendSuccess(res, {
          role: userRole,
          dailyLimit: null,
          used: 0,
          remaining: null,
          resetsAt: null,
          isUnlimited: true,
        });
      }

      // Count plans completed today in UTC
      const now = new Date();
      const todayStartUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

      const { count, error } = await supabaseAdmin
        .from("marketing_plans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "completed")
        .gte("created_at", todayStartUTC);

      if (error) {
        throw new Error("تعذر استعلام رصيد الكوتا من قاعدة البيانات.");
      }

      const used = count || 0;
      const remaining = Math.max(0, policy.dailyLimit - used);

      return sendSuccess(res, {
        role: userRole,
        dailyLimit: policy.dailyLimit,
        used,
        remaining,
        resetsAt: getNextUTCDayReset(),
        isUnlimited: false,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/plans/:id/external-ai/parse
   * Non-mutating proposal generator.
   * Parses and validates raw AI responses, simulates strategic impact, and produces proposal.
   * Consumes 0 AI Quota, performs ZERO DB writes.
   */
  async parseExternalAiResponse(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.userId;
      const { mode, day, raw_response } = req.body;

      // 1. Fetch current plan and all 30 content items
      const { data: plan, error: planError } = await supabaseAdmin
        .from("marketing_plans")
        .select("id, content_version")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planError || !plan) {
        return sendError(res, "NOT_FOUND", "الخطة التسويقية غير موجودة أو لا تملك صلاحية الوصول إليها.", 404);
      }

      const { data: allItems, error: itemsError } = await supabaseAdmin
        .from("content_items")
        .select("*")
        .eq("marketing_plan_id", planId)
        .eq("user_id", userId)
        .order("day_number", { ascending: true });

      if (itemsError || !allItems || allItems.length === 0) {
        return sendError(res, "NOT_FOUND", "تعذر العثور على منشورات الخطة.", 404);
      }

      // 2. Extract JSON string from raw_response
      let jsonString = null;
      const blockRegex = /```(?:madar-changes|json)?\s*([\s\S]*?)```/i;
      const match = raw_response.match(blockRegex);

      if (match && match[1]) {
        jsonString = match[1].trim();
      } else {
        const firstBrace = raw_response.indexOf("{");
        const lastBrace = raw_response.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonString = raw_response.substring(firstBrace, lastBrace + 1).trim();
        }
      }

      if (!jsonString) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "لم يتم العثور على كود JSON صالح في الرد المستلم. يرجى التأكد من نسخ كود التعديل كاملاً.",
          400
        );
      }

      let parsedPayload;
      try {
        parsedPayload = JSON.parse(jsonString);
      } catch (parseErr) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "صيغة JSON غير صحيحة أو تالفة في الرد المستلم.",
          400,
          parseErr.message
        );
      }

      // 3. Strict Schema Validation (Fail-closed against unknown keys / Blocker B06)
      let changeSet = [];
      let summaryArabic = "";

      if (mode === "single_day") {
        const validation = externalAiSingleDayContractSchema.safeParse(parsedPayload);
        if (!validation.success) {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "بنية الرد غير مطابقة لمعيار التعديل لليوم الواحد أو تحتوي على حقول غير مصرح بها.",
            422,
            validation.error.flatten()
          );
        }

        const data = validation.data;
        if (data.day !== day) {
          return sendError(
            res,
            "DAY_MISMATCH",
            `اليوم المستخرج من رد الذكاء الاصطناعي (${data.day}) لا يطابق اليوم المطلوب تعديله (${day}).`,
            422
          );
        }

        const currentTargetItem = allItems.find((i) => i.day_number === day);
        if (!currentTargetItem) {
          return sendError(res, "ITEM_NOT_FOUND", `منشور اليوم ${day} غير موجود ضمن هذه الخطة.`, 404);
        }

        changeSet.push({
          day_number: day,
          expected_revision: currentTargetItem.revision,
          changes: data.changes,
        });

        summaryArabic = data.summary || "تم تحليل تعديلات اليوم بنجاح.";
      } else {
        const validation = externalAiMultiDayContractSchema.safeParse(parsedPayload);
        if (!validation.success) {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "بنية الرد غير مطابقة لمعيار التعديل المتعدد أو تحتوي على حقول غير مصرح بها.",
            422,
            validation.error.flatten()
          );
        }

        const data = validation.data;
        summaryArabic = data.summary || "تم تحليل تعديلات الأيام المتعددة بنجاح.";

        for (const item of data.days) {
          const currentTargetItem = allItems.find((i) => i.day_number === item.day);
          if (!currentTargetItem) {
            return sendError(res, "ITEM_NOT_FOUND", `منشور اليوم ${item.day} غير موجود ضمن هذه الخطة.`, 404);
          }

          changeSet.push({
            day_number: item.day,
            expected_revision: currentTargetItem.revision,
            changes: item.changes,
          });
        }
      }

      // 4. Calculate Strategic Impact
      const strategicImpact = calculateStrategicImpactForChangeSet({
        allItems,
        changeSet,
      });

      return sendSuccess(res, {
        mode,
        summary: summaryArabic,
        expectedPlanVersion: plan.content_version,
        changeSet,
        strategicImpact,
      });
    } catch (err) {
      logger.error({ err: err.message }, "[PlansController.parseExternalAiResponse] Unexpected failure");
      return sendError(res, "UNEXPECTED_DB_ERROR", "حدث خطأ غير متوقع أثناء معالجة الطلب.", 500);
    }
  }

  /**
   * POST /api/v1/plans/:id/content/:day/scoped-ai
   * Scoped AI proposal generation using Gemini (Consumes 1 AI post regen quota).
   * Enforces fail-closed validation on requested leaf fields.
   */
  async generateScopedAiProposal(req, res, next) {
    try {
      const { id: planId, day } = req.params;
      const userId = req.user.userId;
      const dayNumber = parseInt(day, 10);

      if (isNaN(dayNumber) || dayNumber < 1 || dayNumber > 30) {
        throw new ValidationError("رقم اليوم يجب أن يكون بين 1 و 30.");
      }

      // 1. Rate limit / Quota check (10 per hour per user)
      const rateLimit = checkRateLimit(userId, 10, 60 * 60 * 1000);
      if (!rateLimit.allowed) {
        throw new RateLimitError(
          `لقد تجاوزت الحد الأقصى لإعادة التوليد (10 مرات في الساعة). يرجى الانتظار ${rateLimit.resetMinutes} دقيقة.`
        );
      }

      const { scope, instruction, expectedRevision, expectedPlanVersion } = req.body;

      // 2. Fetch Plan & Target Item verifying ownership
      const { data: plan, error: planError } = await supabaseAdmin
        .from("marketing_plans")
        .select("id, product_name, product_description, product_category, target_audience, problem_solved, brand_tone, website_url, strategy, content_pillars, content_version")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planError || !plan) {
        return sendError(res, "NOT_FOUND", "الخطة غير موجودة أو لا تملك صلاحية التعديل.", 404);
      }

      if (plan.content_version !== expectedPlanVersion) {
        return sendError(res, "PLAN_VERSION_CONFLICT", "تم تحديث الخطة في الخلفية أثناء تحريرك. يرجى إعادة تحميل الصفحة.", 409, {
          current_plan_version: plan.content_version,
        });
      }

      const { data: allItems, error: itemsError } = await supabaseAdmin
        .from("content_items")
        .select("*")
        .eq("marketing_plan_id", planId)
        .eq("user_id", userId)
        .order("day_number", { ascending: true });

      const currentItem = (allItems || []).find((i) => i.day_number === dayNumber);
      if (itemsError || !currentItem) {
        return sendError(res, "ITEM_NOT_FOUND", `منشور اليوم ${dayNumber} غير موجود في هذه الخطة.`, 404);
      }

      if (currentItem.revision !== expectedRevision) {
        return sendError(res, "REVISION_CONFLICT", "تم تعديل هذا المنشور من جلسة أخرى أثناء قيامك بالتحرير.", 409, {
          current_revision: currentItem.revision,
          current_item: currentItem,
        });
      }

      // 3. Construct Gemini Prompt with explicit scope constraint
      const scopeDescription = scope.includes("entire_post")
        ? "جميع حقول المنشور التسعة"
        : scope.join("، ");

      const systemPrompt = `أنت خبير استراتيجي في كتابة وتصميم محتوى إنستغرام لبراند مدروس.
مهمتك: توليد اقتراح تعديل محدد بدقة لمنشور اليوم رقم (${dayNumber}) مع الالتزام الصارم بالنطاق المسموح به: [${scopeDescription}].

قاعدة حاسمة (Fail-Closed Boundary):
ممنوع نهائياً إعادة أي حقول غير مطلوبة داخل النطاق المصرح به أعلاه.
إذا كان النطاق هو "caption" فقط، فأرجع كائن يحتوي على "caption" فقط (ويمكن إضافة "summary").
إذا كان النطاق يحتوي على "design_copy.headline" فقط، فأرجع design_copy يحتوي على headline فقط دون subtext أو cta.`;

      const userPrompt = `### سياق الخطة والبراند:
- البراند: ${plan.product_name}
- الجمهور المستهدف: ${plan.target_audience}
- نبرة الصوت: ${(plan.brand_tone || []).join(", ")}

### المنشور الحالي لليوم ${dayNumber}:
- نوع القالب: ${currentItem.post_type}
- الهدف: ${currentItem.content_objective}
- الركيزة: ${currentItem.content_pillar}
- الكابشن الحالي: ${currentItem.caption}
- تصميم البوست الحالي: ${JSON.stringify(currentItem.design_copy || {})}
- التوجيه البصري: ${currentItem.design_reference}
- الدعوة لاتخاذ إجراء: ${currentItem.cta}

### التعديل المطلوب:
- النطاق المستهدف: [${scopeDescription}]
- تعليمات التعديل: "${instruction}"

أعد كائن JSON صالح ومحدد بالنطاق المطلوب فقط.`;

      const aiRaw = await geminiService.generateStructuredJSON({
        systemPrompt,
        userPrompt,
        temperature: 0.7,
      });

      // 4. Validate output with dynamic strict schema (Fail-closed / Blocker B08, B09)
      const strictSchema = buildStrictScopedOutputSchema(scope);
      const validation = strictSchema.safeParse(aiRaw);

      if (!validation.success) {
        logger.warn(
          { validationErrors: validation.error.flatten(), aiRaw, scope },
          "[Scoped AI] AI output violated requested scope boundary"
        );
        return sendError(
          res,
          "INVALID_SCOPE",
          "الرد المستلم من الذكاء الاصطناعي يحتوي على حقول خارج النطاق المصرّح به.",
          422,
          validation.error.flatten()
        );
      }

      const validatedOutput = validation.data;
      const { summary = "", ...changesOnly } = validatedOutput;

      // 5. Calculate Strategic Impact
      const changeSet = [
        {
          day_number: dayNumber,
          expected_revision: currentItem.revision,
          changes: changesOnly,
        },
      ];

      const strategicImpact = calculateStrategicImpactForChangeSet({
        allItems,
        changeSet,
      });

      return sendSuccess(
        res,
        {
          dayNumber,
          scope,
          summary: summary || "تم توليد الاقتراح بنجاح ضمن النطاق المحدد.",
          changes: changesOnly,
          strategicImpact,
          expectedRevision: currentItem.revision,
          expectedPlanVersion: plan.content_version,
          remaining: rateLimit.remaining,
        },
        200,
        "تم توليد اقتراح التعديل بنجاح!"
      );
    } catch (err) {
      logger.error({ err: err.message }, "[PlansController.generateScopedAiProposal] Failure");
      next(err);
    }
  }

  /**
   * PATCH /api/v1/plans/:id/content/:day
   * Single-Day Atomic Commit (Manual or AI-approved mutation).
   * Executes atomic apply_content_item_mutation RPC.
   */
  async applySingleDayMutation(req, res, next) {
    try {
      const { id: planId, day } = req.params;
      const userId = req.user.userId;
      const dayNumber = parseInt(day, 10);

      if (isNaN(dayNumber) || dayNumber < 1 || dayNumber > 30) {
        throw new ValidationError("رقم اليوم يجب أن يكون بين 1 و 30.");
      }

      const { expectedRevision, expectedPlanVersion, editSource, changes } = req.body;

      // Find item ID
      const { data: currentItem, error: findError } = await supabaseAdmin
        .from("content_items")
        .select("id")
        .eq("marketing_plan_id", planId)
        .eq("day_number", dayNumber)
        .eq("user_id", userId)
        .maybeSingle();

      if (findError || !currentItem) {
        return sendError(res, "ITEM_NOT_FOUND", `تعذر العثور على منشور اليوم ${dayNumber} ضمن هذه الخطة.`, 404);
      }

      // Execute RPC
      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("apply_content_item_mutation", {
        p_plan_id: planId,
        p_item_id: currentItem.id,
        p_user_id: userId,
        p_expected_revision: expectedRevision,
        p_expected_plan_version: expectedPlanVersion,
        p_edit_source: editSource,
        p_changes: changes,
      });

      if (rpcError) {
        logger.error({ rpcError }, "[PlansController.applySingleDayMutation] DB Exception in RPC");
        return sendError(res, "UNEXPECTED_DB_ERROR", "حدث خطأ غير متوقع أثناء معالجة الطلب في قاعدة البيانات.", 500);
      }

      if (!rpcResult.success) {
        return this._handleRpcError(res, rpcResult);
      }

      // Trigger background Google Sheets sync
      googleSheetsService.syncPlanToGoogleSheet(planId, rpcResult.new_plan_version).catch((syncErr) => {
        logger.error({ syncErr: syncErr.message, planId }, "[PlansController.applySingleDayMutation] Background sync error");
      });

      return sendSuccess(
        res,
        {
          item: rpcResult.item,
          newRevision: rpcResult.new_revision,
          newPlanVersion: rpcResult.new_plan_version,
        },
        200,
        "تم حفظ التعديلات بنجاح!"
      );
    } catch (err) {
      logger.error({ err: err.message }, "[PlansController.applySingleDayMutation] Exception");
      next(err);
    }
  }

  /**
   * POST /api/v1/plans/:id/content/batch
   * Multi-Day Atomic Batch Mutation.
   * All-or-Nothing execution with deadlock-free ascending day locking.
   */
  async applyBatchMutation(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.userId;
      const { expectedPlanVersion, editSource, batch } = req.body;

      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("apply_content_items_batch_mutation", {
        p_plan_id: planId,
        p_user_id: userId,
        p_expected_plan_version: expectedPlanVersion,
        p_edit_source: editSource,
        p_batch: batch,
      });

      if (rpcError) {
        logger.error({ rpcError }, "[PlansController.applyBatchMutation] DB Exception in RPC");
        return sendError(res, "UNEXPECTED_DB_ERROR", "حدث خطأ غير متوقع أثناء معالجة الطلب في قاعدة البيانات.", 500);
      }

      if (!rpcResult.success) {
        return this._handleRpcError(res, rpcResult);
      }

      // Trigger background Google Sheets sync
      googleSheetsService.syncPlanToGoogleSheet(planId, rpcResult.new_plan_version).catch((syncErr) => {
        logger.error({ syncErr: syncErr.message, planId }, "[PlansController.applyBatchMutation] Background sync error");
      });

      return sendSuccess(
        res,
        {
          updatedCount: rpcResult.updated_count,
          newPlanVersion: rpcResult.new_plan_version,
        },
        200,
        `تم تحديث ${rpcResult.updated_count} يوماً بنجاح في دفعة واحدة!`
      );
    } catch (err) {
      logger.error({ err: err.message }, "[PlansController.applyBatchMutation] Exception");
      next(err);
    }
  }

  /**
   * POST /api/v1/plans/:id/content/:day/undo
   * Concurrency-safe single-step undo.
   * Restores previous_state snapshot, clears previous_state, sets edit_source to 'manual'.
   */
  async undoContentMutation(req, res, next) {
    try {
      const { id: planId, day } = req.params;
      const userId = req.user.userId;
      const dayNumber = parseInt(day, 10);

      if (isNaN(dayNumber) || dayNumber < 1 || dayNumber > 30) {
        throw new ValidationError("رقم اليوم يجب أن يكون بين 1 و 30.");
      }

      const { expectedRevision, expectedPlanVersion } = req.body;

      // Find item ID
      const { data: currentItem, error: findError } = await supabaseAdmin
        .from("content_items")
        .select("id")
        .eq("marketing_plan_id", planId)
        .eq("day_number", dayNumber)
        .eq("user_id", userId)
        .maybeSingle();

      if (findError || !currentItem) {
        return sendError(res, "ITEM_NOT_FOUND", `تعذر العثور على منشور اليوم ${dayNumber} ضمن هذه الخطة.`, 404);
      }

      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("undo_content_item_mutation", {
        p_plan_id: planId,
        p_item_id: currentItem.id,
        p_user_id: userId,
        p_expected_revision: expectedRevision,
        p_expected_plan_version: expectedPlanVersion,
      });

      if (rpcError) {
        logger.error({ rpcError }, "[PlansController.undoContentMutation] DB Exception in RPC");
        return sendError(res, "UNEXPECTED_DB_ERROR", "حدث خطأ غير متوقع أثناء معالجة الطلب في قاعدة البيانات.", 500);
      }

      if (!rpcResult.success) {
        return this._handleRpcError(res, rpcResult);
      }

      // Trigger background Google Sheets sync
      googleSheetsService.syncPlanToGoogleSheet(planId, rpcResult.new_plan_version).catch((syncErr) => {
        logger.error({ syncErr: syncErr.message, planId }, "[PlansController.undoContentMutation] Background sync error");
      });

      return sendSuccess(
        res,
        {
          item: rpcResult.item,
          newRevision: rpcResult.new_revision,
          newPlanVersion: rpcResult.new_plan_version,
        },
        200,
        "تم التراجع عن التعديل واستعادة الحالة السابقة بنجاح!"
      );
    } catch (err) {
      logger.error({ err: err.message }, "[PlansController.undoContentMutation] Exception");
      next(err);
    }
  }

  /**
   * Translates PostgreSQL RPC application error payload to HTTP response (Blockers B14, B15).
   *
   * @private
   * @param {import("express").Response} res
   * @param {Object} rpcResult - JSONB payload { success: false, error: string, ... }
   */
  _handleRpcError(res, rpcResult) {
    const code = rpcResult.error;

    switch (code) {
      case "NOT_FOUND":
        return sendError(res, "NOT_FOUND", "الخطة التسويقية غير موجودة أو لا تملك صلاحية الوصول إليها.", 404);

      case "ITEM_NOT_FOUND":
        return sendError(
          res,
          "ITEM_NOT_FOUND",
          rpcResult.day
            ? `تعذر العثور على منشور اليوم ${rpcResult.day} ضمن هذه الخطة.`
            : "تعذر العثور على منشور اليوم المطلوب ضمن هذه الخطة.",
          404
        );

      case "REVISION_CONFLICT":
        return sendError(
          res,
          "REVISION_CONFLICT",
          "تم تعديل هذا المنشور من جلسة أخرى أثناء قيامك بالتحرير. يرجى مراجعة التحديثات.",
          409,
          {
            conflict_day: rpcResult.conflict_day,
            current_revision: rpcResult.current_revision,
            current_item: rpcResult.current_item,
          }
        );

      case "PLAN_VERSION_CONFLICT":
        return sendError(
          res,
          "PLAN_VERSION_CONFLICT",
          "تم تحديث الخطة بالكامل في الخلفية أثناء تحريرك. يرجى إعادة تحميل الصفحة.",
          409,
          {
            current_plan_version: rpcResult.current_plan_version,
          }
        );

      case "DUPLICATE_DAY_REJECTED":
        return sendError(
          res,
          "DUPLICATE_DAY_REJECTED",
          "يحتوي طلب التعديل على أيام مكررة. يجب تضمين كل يوم مرة واحدة فقط.",
          422
        );

      case "EMPTY_BATCH":
        return sendError(
          res,
          "EMPTY_BATCH",
          "لا يحتوي طلب التعديل على أي أيام لتحديثها.",
          422
        );

      case "INVALID_EDIT_SOURCE":
        return sendError(
          res,
          "INVALID_EDIT_SOURCE",
          "مصدر التعديل المقدم غير معتمد نظامياً.",
          422
        );

      case "NO_PREVIOUS_STATE":
        return sendError(
          res,
          "NO_PREVIOUS_STATE",
          "لا توجد حالة سابقة محفوظة لهذا المنشور للتراجع إليها.",
          409
        );

      default:
        logger.error({ rpcResult }, "[_handleRpcError] Unhandled RPC error code");
        return sendError(res, "UNEXPECTED_DB_ERROR", "حدث خطأ غير متوقع أثناء معالجة الطلب في قاعدة البيانات.", 500);
    }
  }
}

export const plansController = new PlansController();
