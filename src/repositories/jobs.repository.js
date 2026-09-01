import { supabaseAdmin } from "../config/supabase.js";
import { AppError } from "../utils/errors.js";

/**
 * Jobs Repository - Data Access Layer for generation_jobs
 * Tracks the asynchronous generation pipeline state machine.
 */
export class JobsRepository {
  /**
   * Creates a new generation job record in queued state
   *
   * @param {string} planId - UUID of the marketing plan
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Object>} Created job row
   */
  async createJob(planId, userId) {
    const { data, error } = await supabaseAdmin
      .from("generation_jobs")
      .upsert(
        {
          marketing_plan_id: planId,
          user_id: String(userId),
          status: "queued",
          current_step: "Queued for generation",
          error_message: null,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
        { onConflict: "marketing_plan_id" }
      )
      .select()
      .single();

    if (error) {
      throw new AppError("DB_ERROR", "تعذر إنشاء أو إعادة تعيين مهمة التوليد.", 500, error);
    }

    return data;
  }

  /**
   * Updates the status and current progress step of a generation job
   *
   * @param {string} jobId - UUID of the generation job
   * @param {string} status - Job status enum
   * @param {string} currentStep - Human-readable Arabic progress description
   * @param {string|null} errorMessage - Optional failure details
   * @returns {Promise<Object>} Updated job row
   */
  async updateJobStatus(jobId, status, currentStep, errorMessage = null) {
    const isFinished = status === "completed" || status === "failed";
    const payload = {
      status,
      current_step: currentStep,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
      ...(isFinished ? { completed_at: new Date().toISOString() } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from("generation_jobs")
      .update(payload)
      .eq("id", jobId)
      .select()
      .single();

    if (error) {
      throw new AppError("DB_ERROR", "تعذر تحديث حالة مهمة التوليد.", 500, error);
    }

    return data;
  }

  /**
   * Retrieves the generation job associated with a plan, verifying user ownership
   *
   * @param {string} planId - UUID of the marketing plan
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Object|null>}
   */
  async getJobByPlanId(planId, userId) {
    const { data, error } = await supabaseAdmin
      .from("generation_jobs")
      .select("*")
      .eq("marketing_plan_id", planId)
      .eq("user_id", String(userId))
      .maybeSingle();

    if (error) {
      throw new AppError("DB_ERROR", "تعذر جلب حالة مهمة التوليد.", 500, error);
    }

    return data;
  }
}

export const jobsRepository = new JobsRepository();
