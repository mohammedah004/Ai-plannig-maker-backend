import { supabaseAdmin } from "../config/supabase.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Google Sheet Exports Repository
 * Handles tracking and persistence for spreadsheet generation and drive sharing.
 */
export class ExportsRepository {
  /**
   * Retrieves the export record associated with a marketing plan.
   *
   * @param {string} planId - Marketing plan UUID
   * @param {string} userId - Canonical user ID (tenant isolation)
   * @returns {Promise<Object|null>}
   */
  async getExportByPlanId(planId, userId) {
    const { data, error } = await supabaseAdmin
      .from("google_sheet_exports")
      .select("*")
      .eq("marketing_plan_id", planId)
      .eq("user_id", String(userId))
      .maybeSingle();

    if (error) {
      logger.error({ err: error.message, planId, userId }, "Failed to fetch export record");
      throw new AppError("DB_ERROR", "تعذر جلب بيانات تصدير جوجل شيت.", 500, error);
    }

    return data;
  }

  /**
   * Creates a new pending export record.
   *
   * @param {string} planId - Marketing plan UUID
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Object>}
   */
  async createExport(planId, userId) {
    const { data, error } = await supabaseAdmin
      .from("google_sheet_exports")
      .insert({
        marketing_plan_id: planId,
        user_id: String(userId),
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error.message, planId, userId }, "Failed to create export record");
      throw new AppError("DB_ERROR", "تعذر إنشاء سجل تصدير جوجل شيت.", 500, error);
    }

    return data;
  }

  /**
   * Updates status and metadata for a sheet export.
   *
   * @param {string} planId - Marketing plan UUID
   * @param {string} status - 'pending' | 'exporting' | 'completed' | 'completed_unshared' | 'failed'
   * @param {Object} [details]
   * @param {string} [details.spreadsheetId] - Google Spreadsheet ID
   * @param {string} [details.spreadsheetUrl] - Direct web URL
   * @param {string|null} [details.errorMessage] - Error details if any
   * @returns {Promise<Object>}
   */
  async updateExportStatus(planId, status, { spreadsheetId = null, spreadsheetUrl = null, errorMessage = null } = {}) {
    const payload = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (spreadsheetId !== null) payload.spreadsheet_id = spreadsheetId;
    if (spreadsheetUrl !== null) payload.spreadsheet_url = spreadsheetUrl;
    if (errorMessage !== undefined) payload.error_message = errorMessage;

    const { data, error } = await supabaseAdmin
      .from("google_sheet_exports")
      .update(payload)
      .eq("marketing_plan_id", planId)
      .select()
      .maybeSingle();

    if (error) {
      logger.error({ err: error.message, planId, status }, "Failed to update export status");
      throw new AppError("DB_ERROR", "تعذر تحديث حالة تصدير جوجل شيت.", 500, error);
    }

    return data;
  }
}

export const exportsRepository = new ExportsRepository();
