import { supabaseAdmin } from "../config/supabase.js";
import { AppError } from "../utils/errors.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Plans Repository - Data Access Layer for marketing_plans
 * All operations are strictly scoped by user_id for ownership isolation.
 */
export class PlansRepository {
  /**
   * Creates a new marketing plan record
   *
   * @param {string} userId - Owner's canonical user ID
   * @param {Object} planInput - Validated form input
   * @returns {Promise<Object>} Created plan row
   */
  async createPlan(userId, planInput) {
    const payload = {
      user_id: String(userId),
      product_name: planInput.product_name,
      product_description: planInput.product_description,
      product_category: planInput.product_category,
      target_audience: planInput.target_audience,
      problem_solved: planInput.problem_solved,
      marketing_objective: planInput.marketing_objective,
      brand_tone: Array.isArray(planInput.brand_tone) ? planInput.brand_tone : [],
      website_url: planInput.website_url || null,
      additional_context: planInput.additional_context || null,
      status: planInput.status || "draft",
      ...(planInput.brand_profile_id ? { brand_profile_id: planInput.brand_profile_id } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from("marketing_plans")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new AppError(
        "DB_ERROR",
        "تعذر إنشاء سجل الخطة التسويقية في قاعدة البيانات.",
        500,
        error
      );
    }

    return data;
  }

  /**
   * Retrieves all marketing plans owned by a specific user
   *
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Array>}
   */
  async getPlansByUser(userId) {
    const { data, error } = await supabaseAdmin
      .from("marketing_plans")
      .select(`
        id,
        brand_profile_id,
        product_name,
        product_category,
        marketing_objective,
        status,
        created_at,
        updated_at,
        google_sheet_exports (
          spreadsheet_url,
          status
        ),
        generation_jobs (
          status,
          current_step,
          error_message
        )
      `)
      .eq("user_id", String(userId))
      .order("created_at", { ascending: false });

    if (error) {
      throw new AppError(
        "DB_ERROR",
        "تعذر جلب الخطط التسويقية من قاعدة البيانات.",
        500,
        error
      );
    }

    return data || [];
  }

  /**
   * Retrieves a single marketing plan by ID verifying ownership
   *
   * @param {string} planId - UUID of the plan
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Object|null>}
   */
  async getPlanById(planId, userId) {
    if (!planId || !UUID_REGEX.test(planId)) {
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from("marketing_plans")
      .select(`
        *,
        google_sheet_exports (
          spreadsheet_id,
          spreadsheet_url,
          status,
          error_message
        ),
        generation_jobs (
          id,
          status,
          current_step,
          error_message,
          started_at,
          completed_at
        )
      `)
      .eq("id", planId)
      .eq("user_id", String(userId))
      .maybeSingle();

    if (error) {
      throw new AppError(
        "DB_ERROR",
        "تعذر جلب تفاصيل الخطة التسويقية.",
        500,
        error
      );
    }

    return data;
  }

  /**
   * Cascading delete of a plan and all its child records, verifying ownership
   *
   * @param {string} planId - UUID of the plan
   * @param {string} userId - Canonical user ID
   * @returns {Promise<boolean>} True if a row was deleted, false if not found
   */
  async deletePlan(planId, userId) {
    if (!planId || !UUID_REGEX.test(planId)) {
      return false;
    }

    // 1. Verify ownership first
    const { data: plan, error: fetchErr } = await supabaseAdmin
      .from("marketing_plans")
      .select("id")
      .eq("id", planId)
      .eq("user_id", String(userId))
      .maybeSingle();

    if (fetchErr) {
      throw new AppError("DB_ERROR", "تعذر التحقق من ملكية الخطة.", 500, fetchErr);
    }

    if (!plan) {
      return false;
    }

    // 2. Cascade delete children
    await supabaseAdmin.from("content_items").delete().eq("marketing_plan_id", planId);
    await supabaseAdmin.from("google_sheet_exports").delete().eq("marketing_plan_id", planId);
    await supabaseAdmin.from("generation_jobs").delete().eq("marketing_plan_id", planId);

    // 3. Delete parent plan
    const { error: deleteErr } = await supabaseAdmin
      .from("marketing_plans")
      .delete()
      .eq("id", planId)
      .eq("user_id", String(userId));

    if (deleteErr) {
      throw new AppError("DB_ERROR", "تعذر حذف الخطة من قاعدة البيانات.", 500, deleteErr);
    }

    return true;
  }

  /**
   * Atomically completes a marketing plan, replaces content items,
   * and updates generation job status via PostgreSQL RPC
   */
  async completePlan({
    planId,
    userId,
    strategy,
    contentPillars,
    objectiveDistribution,
    contentItems,
    jobId,
  }) {
    const { error } = await supabaseAdmin.rpc("complete_marketing_plan", {
      p_plan_id: planId,
      p_user_id: String(userId),
      p_strategy: strategy,
      p_content_pillars: contentPillars,
      p_objective_distribution: objectiveDistribution,
      p_content_items: contentItems,
      p_job_id: jobId,
    });

    if (error) {
      if (error.code === "P0002" || error.message?.includes("not found for user")) {
        throw new AppError(
          "PLAN_OWNERSHIP_ERROR",
          "الخطة غير موجودة أو لا تملك صلاحية تعديلها.",
          404,
          { planId, userId }
        );
      }

      if (error.code === "42501" || error.message?.includes("permission denied")) {
        throw new AppError(
          "DATABASE_PERMISSION_DENIED",
          "صلاحيات قاعدة البيانات غير كافية لتنفيذ هذا الإجراء.",
          403
        );
      }

      throw new AppError(
        "PLAN_COMPLETION_FAILED",
        `فشل حفظ واكتمال الخطة في قاعدة البيانات: ${error.message}`,
        500,
        error
      );
    }

    return { success: true };
  }
}

export const plansRepository = new PlansRepository();
