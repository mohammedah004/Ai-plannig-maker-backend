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
        .select("id, product_name, status")
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

      // 2. Fetch Export Record
      const exportRecord = await exportsRepository.getExportByPlanId(planId, userId);
      if (exportRecord && exportRecord.status === "completed" && !exportRecord.error_message) {
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

      // 4. Fetch User Email from Profiles
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("auth_user_id", userId)
        .maybeSingle();

      const userEmail = userProfile?.email || null;

      // 5. Execute Export (reusing existing spreadsheetId if present to avoid duplicate sheets)
      const existingSpreadsheetId = exportRecord?.spreadsheet_id || null;

      const result = await googleSheetsService.exportPlanToSheets({
        productName: plan.product_name,
        userEmail,
        contentItems,
        userId,
        existingSpreadsheetId,
      });

      if (result.status === "completed") {
        await exportsRepository.updateExportStatus(planId, "completed", {
          spreadsheetId: result.spreadsheetId,
          spreadsheetUrl: result.spreadsheetUrl,
          errorMessage: result.isShared ? null : result.errorMessage,
        });

        return sendSuccess(
          res,
          {
            planId,
            status: "completed",
            isShared: result.isShared,
            spreadsheetId: result.spreadsheetId,
            spreadsheetUrl: result.spreadsheetUrl,
            warning: result.isShared ? null : result.errorMessage,
          },
          200,
          result.isShared
            ? "تم تصدير ومشاركة جدول البيانات في Google Sheets بنجاح!"
            : "تم إنشاء جدول البيانات بنجاح ولكن تعذرت المشاركة المباشرة مع البريد."
        );
      } else {
        await exportsRepository.updateExportStatus(planId, "failed", {
          errorMessage: result.errorMessage,
        });

        return sendError(
          res,
          "EXPORT_FAILED",
          result.errorMessage || "فشل تصدير جدول البيانات إلى Google Sheets.",
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
}

export const plansController = new PlansController();
