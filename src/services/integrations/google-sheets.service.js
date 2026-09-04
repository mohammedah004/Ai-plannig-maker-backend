import { google } from "googleapis";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { sanitizeForGoogleSheets } from "./sheets-sanitizer.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { exportsRepository } from "../../repositories/exports.repository.js";

/**
 * Google Sheets & Drive Direct Export Service
 *
 * Implements Platform Owner OAuth2 delegation (Phase 1).
 * Creates Google Sheets directly under owner quota and shares with the user's email as writer.
 */
export class GoogleSheetsService {
  /**
   * Retrieves an authenticated OAuth2 client.
   *
   * @param {Object} [context] - Execution context (e.g. { userId })
   * @returns {google.auth.OAuth2} Authenticated OAuth2 client
   */
  getSheetsAuthClient(context = {}) {
    // Phase 2 Seam: If context contains user-delegated OAuth tokens, use them here.
    // In Phase 1, always use the platform owner's long-lived refresh token.
    return this.getOwnerAuthClient();
  }

  /**
   * Builds an OAuth2 client configured with the platform owner's refresh token.
   */
  getOwnerAuthClient() {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_SHEETS_OWNER_REFRESH_TOKEN) {
      throw new Error(
        "Google Sheets OAuth configuration missing. Ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_SHEETS_OWNER_REFRESH_TOKEN are configured."
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );

    oauth2Client.setCredentials({
      refresh_token: env.GOOGLE_SHEETS_OWNER_REFRESH_TOKEN,
    });

    return oauth2Client;
  }

  /**
   * Step 1: Creates a new Google Spreadsheet under the owner account.
   *
   * @param {google.auth.OAuth2} authClient
   * @param {string} productName
   * @returns {Promise<{ spreadsheetId: string, spreadsheetUrl: string }>}
   */
  async createPlanSpreadsheet(authClient, productName) {
    const sheets = google.sheets({ version: "v4", auth: authClient });

    const title = `${productName || "Marketing Plan"} — 30-Day Content Plan`;
    const resource = {
      properties: {
        title,
      },
      sheets: [
        {
          properties: {
            title: "30-Day Content Calendar",
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    };

    const res = await sheets.spreadsheets.create({
      requestBody: resource,
      fields: "spreadsheetId,spreadsheetUrl",
    });

    const spreadsheetId = res.data.spreadsheetId;
    const spreadsheetUrl = res.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    return { spreadsheetId, spreadsheetUrl };
  }

  /**
   * Step 2: Formats and overwrites/updates the 30 content items in the spreadsheet.
   * Clears old rows and writes sanitized cells to guarantee authoritative consistency.
   *
   * @param {google.auth.OAuth2} authClient
   * @param {string} spreadsheetId
   * @param {Array<Object>} contentItems
   */
  async updateContentRows(authClient, spreadsheetId, contentItems = []) {
    const sheets = google.sheets({ version: "v4", auth: authClient });

    const header = [
      "اليوم (Day)",
      "نوع القالب (Post Type)",
      "الهدف التسويقي (Objective)",
      "الركيزة (Pillar)",
      "العنوان في التصميم (Headline)",
      "الكابشن (Caption)",
      "التوجيه البصري (Design Reference)",
      "الدعوة للإجراء (CTA)",
    ].map((col) => sanitizeForGoogleSheets(col));

    const dataRows = contentItems.map((item) => {
      const headline =
        typeof item.design_copy === "object" && item.design_copy !== null
          ? item.design_copy.headline || ""
          : "";

      return [
        sanitizeForGoogleSheets(`اليوم ${item.day_number || ""}`),
        sanitizeForGoogleSheets(item.post_type || ""),
        sanitizeForGoogleSheets(item.content_objective || ""),
        sanitizeForGoogleSheets(item.content_pillar || ""),
        sanitizeForGoogleSheets(headline),
        sanitizeForGoogleSheets(item.caption || ""),
        sanitizeForGoogleSheets(item.design_reference || ""),
        sanitizeForGoogleSheets(item.cta || ""),
      ];
    });

    const values = [header, ...dataRows];

    // Clear existing range first to prevent leftover rows
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: "'30-Day Content Calendar'!A:H",
      });
    } catch (clearErr) {
      logger.warn(
        { err: clearErr.message, spreadsheetId },
        "[GoogleSheetsService] Range clear warning (proceeding to update)"
      );
    }

    // Write authoritative rows
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'30-Day Content Calendar'!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values,
      },
    });
  }

  /**
   * Alias for backward compatibility with existing tests
   */
  async appendContentRows(authClient, spreadsheetId, contentItems = []) {
    return this.updateContentRows(authClient, spreadsheetId, contentItems);
  }

  /**
   * Step 3: Shares the spreadsheet with the user's email with writer permission.
   *
   * @param {google.auth.OAuth2} authClient
   * @param {string} spreadsheetId
   * @param {string} userEmail
   */
  async shareWithUser(authClient, spreadsheetId, userEmail) {
    if (!userEmail || typeof userEmail !== "string" || !userEmail.includes("@")) {
      logger.warn({ userEmail, spreadsheetId }, "[GoogleSheetsService] Skip share: Invalid or missing user email");
      return { shared: false, reason: "Invalid or missing email" };
    }

    const drive = google.drive({ version: "v3", auth: authClient });

    await drive.permissions.create({
      fileId: spreadsheetId,
      sendNotificationEmail: true,
      requestBody: {
        role: "writer",
        type: "user",
        emailAddress: userEmail,
      },
      fields: "id",
    });

    return { shared: true };
  }

  /**
   * High-Level Pipeline: Executes Create -> Populate -> Share with independent error isolation and ID reuse.
   *
   * @param {Object} params
   * @param {string} params.productName
   * @param {string} params.userEmail
   * @param {Array<Object>} params.contentItems
   * @param {string} [params.userId]
   * @param {string|null} [params.existingSpreadsheetId=null] - If provided, reuses existing sheet avoiding duplicate creation
   * @returns {Promise<{ success: boolean, status: string, isShared: boolean, spreadsheetId?: string, spreadsheetUrl?: string, errorMessage?: string }>}
   */
  async exportPlanToSheets({ productName, userEmail, contentItems, userId, existingSpreadsheetId = null }) {
    let authClient;
    try {
      authClient = this.getSheetsAuthClient({ userId });
    } catch (authErr) {
      logger.error({ err: authErr.message }, "[GoogleSheetsService] Failed to obtain auth client");
      return {
        success: false,
        status: "failed",
        isShared: false,
        errorMessage: authErr.message,
      };
    }

    let spreadsheetId = existingSpreadsheetId;
    let spreadsheetUrl = existingSpreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}`
      : null;

    // Step 1: Create Spreadsheet if not already existing
    if (!spreadsheetId) {
      try {
        logger.info({ productName }, "[GoogleSheetsService] Creating new spreadsheet...");
        const created = await this.createPlanSpreadsheet(authClient, productName);
        spreadsheetId = created.spreadsheetId;
        spreadsheetUrl = created.spreadsheetUrl;
      } catch (createErr) {
        logger.error({ err: createErr.message, productName }, "[GoogleSheetsService] Failed to create spreadsheet");
        return {
          success: false,
          status: "failed",
          isShared: false,
          errorMessage: `فشل إنشاء جدول البيانات: ${createErr.message}`,
        };
      }
    } else {
      logger.info({ spreadsheetId }, "[GoogleSheetsService] Updating existing spreadsheet content...");
    }

    // Step 2: Write authoritative content rows (for BOTH new and existing spreadsheets!)
    try {
      logger.info({ spreadsheetId, rowsCount: contentItems?.length }, "[GoogleSheetsService] Writing content rows...");
      await this.updateContentRows(authClient, spreadsheetId, contentItems);
    } catch (writeErr) {
      logger.error(
        { err: writeErr.message, spreadsheetId },
        "[GoogleSheetsService] Failed to write content rows"
      );
      return {
        success: false,
        status: "failed",
        isShared: false,
        spreadsheetId,
        spreadsheetUrl,
        errorMessage: `فشل إدراج بيانات المحتوى في الجدول: ${writeErr.message}`,
      };
    }

    // Step 3: Share with User Email (Non-blocking partial failure)
    try {
      logger.info({ spreadsheetId, userEmail }, "[GoogleSheetsService] Sharing spreadsheet with user email...");
      await this.shareWithUser(authClient, spreadsheetId, userEmail);

      return {
        success: true,
        status: "completed",
        isShared: true,
        spreadsheetId,
        spreadsheetUrl,
      };
    } catch (shareErr) {
      logger.warn(
        { err: shareErr.message, spreadsheetId, userEmail },
        "[GoogleSheetsService] Drive share step failed (partial success: sheet created and populated)"
      );

      // Return partial success: spreadsheet is populated but permission sharing failed
      return {
        success: true,
        status: "completed",
        isShared: false,
        spreadsheetId,
        spreadsheetUrl,
        errorMessage: `تم إنشاء جدول البيانات بنجاح ولكن تعذرت المشاركة المباشرة مع البريد (${userEmail}): ${shareErr.message}`,
      };
    }
  }

  /**
   * Authoritative Plan Synchronizer
   * Synchronizes the Google Sheet to match the authoritative DB state.
   * Enforces race-condition checks: ensures target_version === marketing_plans.content_version
   * before marking export as completed.
   *
   * @param {string} planId - Marketing plan UUID
   * @param {number} [targetVersion=null] - Desired version to synchronize (defaults to current DB content_version)
   * @returns {Promise<{ success: boolean, status: string, exportedVersion?: number, spreadsheetId?: string, spreadsheetUrl?: string, errorMessage?: string }>}
   */
  async syncPlanToGoogleSheet(planId, targetVersion = null) {
    if (!planId) throw new Error("planId is required for syncPlanToGoogleSheet");

    if (!this._syncQueues) this._syncQueues = new Map();

    const runSync = async () => {
      try {
        // 1. Fetch current plan state
        const { data: plan, error: planErr } = await supabaseAdmin
          .from("marketing_plans")
          .select("id, user_id, product_name, content_version, status")
          .eq("id", planId)
          .maybeSingle();

        if (planErr || !plan) {
          logger.warn({ planId, planErr }, "[GoogleSheetsService.sync] Plan not found");
          return { success: false, status: "failed", errorMessage: "الخطة غير موجودة." };
        }

        // Only sync completed plans
        if (plan.status !== "completed") {
          logger.info({ planId, status: plan.status }, "[GoogleSheetsService.sync] Skipping sync: plan not completed");
          return { success: false, status: "skipped", errorMessage: "الخطة غير مكتملة بعد." };
        }

        const effectiveTargetVersion = targetVersion !== null ? targetVersion : plan.content_version;

        // If targetVersion is behind current DB version, abort this stale sync
        if (plan.content_version > effectiveTargetVersion) {
          logger.warn(
            { planId, currentVersion: plan.content_version, effectiveTargetVersion },
            "[GoogleSheetsService.sync] Aborting sync: DB version is already ahead of requested targetVersion"
          );
          return { success: false, status: "stale", errorMessage: "تم تحديث الخطة بإصدار أحدث." };
        }

        // 2. Fetch export record
        const { data: exportRecord } = await supabaseAdmin
          .from("google_sheet_exports")
          .select("*")
          .eq("marketing_plan_id", planId)
          .maybeSingle();

        // 3. Mark target_version in DB
        if (exportRecord) {
          await exportsRepository.updateExportStatus(planId, "stale", {
            targetVersion: effectiveTargetVersion,
          });
        }

        // 4. Fetch all 30 content items from DB (authoritative)
        const { data: contentItems, error: itemsErr } = await supabaseAdmin
          .from("content_items")
          .select("*")
          .eq("marketing_plan_id", planId)
          .order("day_number", { ascending: true });

        if (itemsErr || !contentItems || contentItems.length === 0) {
          logger.error({ planId, itemsErr }, "[GoogleSheetsService.sync] No content items found");
          return { success: false, status: "failed", errorMessage: "لا توجد عناصر محتوى للمزامنة." };
        }

        // 5. Fetch user email
        const { data: userProfile } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .eq("auth_user_id", plan.user_id)
          .maybeSingle();

        const userEmail = userProfile?.email || null;
        const existingSpreadsheetId = exportRecord?.spreadsheet_id || null;

        // 6. Execute export to Google Sheets
        const exportResult = await this.exportPlanToSheets({
          productName: plan.product_name,
          userEmail,
          contentItems,
          userId: plan.user_id,
          existingSpreadsheetId,
        });

        if (!exportResult.success) {
          logger.error(
            { planId, error: exportResult.errorMessage },
            "[GoogleSheetsService.sync] Google Sheets export failed"
          );
          // DB remains authoritative. Record failed / stale.
          await exportsRepository.updateExportStatus(planId, "failed", {
            errorMessage: exportResult.errorMessage,
            targetVersion: effectiveTargetVersion,
          });

          return {
            success: false,
            status: "failed",
            errorMessage: exportResult.errorMessage,
          };
        }

        // 7. CRITICAL RACE CONDITION CHECK:
        // Verify that marketing_plans.content_version has NOT changed while Google Sheets export was running!
        const { data: freshPlan } = await supabaseAdmin
          .from("marketing_plans")
          .select("content_version")
          .eq("id", planId)
          .single();

        if (freshPlan && freshPlan.content_version !== effectiveTargetVersion) {
          logger.warn(
            {
              planId,
              exportedVersion: effectiveTargetVersion,
              latestPlanVersion: freshPlan.content_version,
            },
            "[GoogleSheetsService.sync] Race detected! Plan was mutated during export. NOT advancing exported_version to newer plan version."
          );

          // DO NOT mark old export as completed for the new version. Keep as stale.
          await exportsRepository.updateExportStatus(planId, "stale", {
            spreadsheetId: exportResult.spreadsheetId,
            spreadsheetUrl: exportResult.spreadsheetUrl,
            errorMessage: "تم تعديل الخطة أثناء المزامنة، جاري انتظار مزامنة الإصدار الأحدث.",
            targetVersion: freshPlan.content_version,
          });

          return {
            success: false,
            status: "stale",
            exportedVersion: effectiveTargetVersion,
            latestPlanVersion: freshPlan.content_version,
          };
        }

        // 8. Success: target_version === content_version === exported_version
        await exportsRepository.updateExportStatus(planId, "completed", {
          spreadsheetId: exportResult.spreadsheetId,
          spreadsheetUrl: exportResult.spreadsheetUrl,
          errorMessage: exportResult.isShared ? null : exportResult.errorMessage,
          targetVersion: effectiveTargetVersion,
          exportedVersion: effectiveTargetVersion,
        });

        logger.info(
          {
            planId,
            version: effectiveTargetVersion,
            spreadsheetId: exportResult.spreadsheetId,
          },
          "✅ [GoogleSheetsService.sync] Successfully synchronized Google Sheet to authoritative version!"
        );

        return {
          success: true,
          status: "completed",
          exportedVersion: effectiveTargetVersion,
          spreadsheetId: exportResult.spreadsheetId,
          spreadsheetUrl: exportResult.spreadsheetUrl,
        };
      } catch (err) {
        logger.error({ planId, err: err.message }, "[GoogleSheetsService.sync] Unexpected sync exception");
        try {
          await exportsRepository.updateExportStatus(planId, "failed", {
            errorMessage: err.message,
          });
        } catch (_) {}
        return { success: false, status: "failed", errorMessage: err.message };
      }
    };

    // Chain execution to avoid concurrent Google Sheets writes for the same plan
    const previousPromise = this._syncQueues.get(planId) || Promise.resolve();
    const currentPromise = previousPromise.then(() => runSync()).finally(() => {
      if (this._syncQueues.get(planId) === currentPromise) {
        this._syncQueues.delete(planId);
      }
    });

    this._syncQueues.set(planId, currentPromise);
    return currentPromise;
  }
}

export const googleSheetsService = new GoogleSheetsService();
