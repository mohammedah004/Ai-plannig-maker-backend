import { google } from "googleapis";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

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
   * Step 2: Formats and appends the 30 content items into the spreadsheet.
   *
   * @param {google.auth.OAuth2} authClient
   * @param {string} spreadsheetId
   * @param {Array<Object>} contentItems
   */
  async appendContentRows(authClient, spreadsheetId, contentItems = []) {
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
    ];

    const dataRows = contentItems.map((item) => {
      const headline =
        typeof item.design_copy === "object" && item.design_copy !== null
          ? item.design_copy.headline || ""
          : "";

      return [
        `اليوم ${item.day_number || ""}`,
        item.post_type || "",
        item.content_objective || "",
        item.content_pillar || "",
        headline,
        item.caption || "",
        item.design_reference || "",
        item.cta || "",
      ];
    });

    const values = [header, ...dataRows];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'30-Day Content Calendar'!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values,
      },
    });
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
   * High-Level Pipeline: Executes Create -> Append -> Share with independent error isolation and ID reuse.
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

    // Step 1: Create Spreadsheet (only if not already existing)
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

      // Step 2: Append Content Rows (only needed when a new sheet was created)
      try {
        logger.info({ spreadsheetId, rowsCount: contentItems?.length }, "[GoogleSheetsService] Appending content rows...");
        await this.appendContentRows(authClient, spreadsheetId, contentItems);
      } catch (appendErr) {
        logger.error(
          { err: appendErr.message, spreadsheetId },
          "[GoogleSheetsService] Failed to append content rows"
        );
        return {
          success: false,
          status: "failed",
          isShared: false,
          spreadsheetId,
          spreadsheetUrl,
          errorMessage: `فشل إدراج بيانات المحتوى في الجدول: ${appendErr.message}`,
        };
      }
    } else {
      logger.info({ spreadsheetId }, "[GoogleSheetsService] Reusing existing spreadsheet for share retry (no duplicate creation)");
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
}

export const googleSheetsService = new GoogleSheetsService();
