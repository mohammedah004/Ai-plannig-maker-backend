import { supabaseAdmin } from "../config/supabase.js";
import { logger } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Dispatches an alert message to configured Webhooks (Discord, Slack, Telegram, or Generic)
 *
 * @param {Object} alert
 * @param {string} alert.type - 'STUCK_JOB' | 'HIGH_FAILURE_RATE' | 'SHEETS_EXPORT_FAILURE' | 'SYSTEM_ERROR'
 * @param {string} alert.jobId
 * @param {string} alert.planId
 * @param {string} alert.details
 * @param {string} alert.timestamp
 */
export async function sendAlertWebhook({ type, jobId = "N/A", planId = "N/A", details = "", timestamp = new Date().toISOString() }) {
  const alertText = `[ALERT] AI Planner Staging/Prod Issue | Type: ${type} | JobId: ${jobId} | PlanId: ${planId} | Details: ${details} | Timestamp: ${timestamp}`;

  const webhookUrl = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  logger.warn({ type, jobId, planId, details }, alertText);

  if (!webhookUrl && (!telegramToken || !telegramChatId)) {
    logger.info("[HealthMonitor] No webhook URL or Telegram credentials configured. Alert logged to stdout only.");
    return { success: true, dispatched: false, message: alertText };
  }

  try {
    // 1. Telegram Bot Dispatcher
    if (telegramToken && telegramChatId) {
      const tgRes = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: `🚨 *AI Planner Alert*\n\n*Type:* \`${type}\`\n*Job ID:* \`${jobId}\`\n*Plan ID:* \`${planId}\`\n*Details:* ${details}\n*Time:* \`${timestamp}\``,
          parse_mode: "Markdown",
        }),
      });
      if (!tgRes.ok) {
        logger.error({ status: tgRes.status }, "[HealthMonitor] Failed to send Telegram alert");
      }
    }

    // 2. Webhook Dispatcher (Discord, Slack, or Generic HTTP Webhook)
    if (webhookUrl) {
      let body;
      if (webhookUrl.includes("discord.com")) {
        body = JSON.stringify({
          content: `🚨 **${alertText}**`,
          embeds: [
            {
              title: `[ALERT] AI Planner Issue: ${type}`,
              color: 0xe74c3c, // Red
              fields: [
                { name: "Type", value: type, inline: true },
                { name: "Job ID", value: jobId, inline: true },
                { name: "Plan ID", value: planId, inline: true },
                { name: "Details", value: details, inline: false },
                { name: "Timestamp", value: timestamp, inline: false },
              ],
            },
          ],
        });
      } else if (webhookUrl.includes("hooks.slack.com")) {
        body = JSON.stringify({
          text: `🚨 *${alertText}*`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*🚨 AI Planner Pipeline Alert*\n*Type:* \`${type}\`\n*Job ID:* \`${jobId}\`\n*Plan ID:* \`${planId}\`\n*Details:* ${details}\n*Time:* \`${timestamp}\``,
              },
            },
          ],
        });
      } else {
        // Generic JSON webhook
        body = JSON.stringify({
          alert: alertText,
          type,
          jobId,
          planId,
          details,
          timestamp,
        });
      }

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!res.ok) {
        logger.error({ status: res.status, url: webhookUrl }, "[HealthMonitor] Webhook dispatch returned non-2xx status");
      } else {
        logger.info({ type, jobId }, "[HealthMonitor] Webhook alert successfully dispatched");
      }
    }

    return { success: true, dispatched: true, message: alertText };
  } catch (err) {
    logger.error({ error: err.message }, "[HealthMonitor] Failed to dispatch webhook alert");
    return { success: false, error: err.message, message: alertText };
  }
}

/**
 * Runs the complete automated pipeline health check
 *
 * @returns {Promise<Object>} Summary of checks and alerts triggered
 */
export async function runHealthMonitoringChecks() {
  const now = new Date();
  const summary = {
    timestamp: now.toISOString(),
    stuckJobsCount: 0,
    failedJobsCount: 0,
    totalJobsLastHour: 0,
    failureRate: 0,
    failedExportsCount: 0,
    alertsTriggered: [],
  };

  logger.info("[HealthMonitor] Starting automated health & pipeline monitoring check...");

  try {
    // -------------------------------------------------------------------------
    // 1. Stuck Jobs Check (> 5 minutes in non-terminal state)
    // -------------------------------------------------------------------------
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const { data: stuckJobs, error: stuckErr } = await supabaseAdmin
      .from("generation_jobs")
      .select("id, marketing_plan_id, status, current_step, updated_at, error_message")
      .in("status", ["queued", "generating", "generating_strategy", "generating_pillars", "generating_content", "exporting_sheet"])
      .lt("updated_at", fiveMinutesAgo);

    if (stuckErr) {
      logger.error({ error: stuckErr }, "[HealthMonitor] Error querying stuck jobs");
    } else if (stuckJobs && stuckJobs.length > 0) {
      summary.stuckJobsCount = stuckJobs.length;
      for (const job of stuckJobs) {
        const details = `Job is stuck in status '${job.status}' (Step: "${job.current_step || 'N/A'}") since ${job.updated_at} (>5 minutes)`;
        await sendAlertWebhook({
          type: "STUCK_JOB",
          jobId: job.id,
          planId: job.marketing_plan_id || "N/A",
          details,
          timestamp: now.toISOString(),
        });
        summary.alertsTriggered.push({ type: "STUCK_JOB", jobId: job.id, details });
      }
    }

    // -------------------------------------------------------------------------
    // 2. Rolling 1-Hour Failure Rate Check (Threshold: > 5%)
    // -------------------------------------------------------------------------
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { data: recentJobs, error: recentErr } = await supabaseAdmin
      .from("generation_jobs")
      .select("id, status, error_message, marketing_plan_id")
      .gte("created_at", oneHourAgo);

    if (recentErr) {
      logger.error({ error: recentErr }, "[HealthMonitor] Error querying recent jobs for failure rate");
    } else if (recentJobs && recentJobs.length > 0) {
      summary.totalJobsLastHour = recentJobs.length;
      const failedJobs = recentJobs.filter((j) => j.status === "failed");
      summary.failedJobsCount = failedJobs.length;
      summary.failureRate = (summary.failedJobsCount / summary.totalJobsLastHour) * 100;

      // Only trigger if at least 2 total jobs exist to prevent noise on isolated single attempts
      if (summary.totalJobsLastHour >= 2 && summary.failureRate > 5.0) {
        const details = `Rolling 1-hour failure rate is ${summary.failureRate.toFixed(1)}% (${summary.failedJobsCount}/${summary.totalJobsLastHour} jobs failed, threshold: 5.0%)`;
        await sendAlertWebhook({
          type: "HIGH_FAILURE_RATE",
          jobId: "N/A",
          planId: "N/A",
          details,
          timestamp: now.toISOString(),
        });
        summary.alertsTriggered.push({ type: "HIGH_FAILURE_RATE", details });
      }
    }

    // -------------------------------------------------------------------------
    // 3. Google Sheets Export Failure Check (Rolling 1 Hour)
    // -------------------------------------------------------------------------
    const { data: failedExports, error: exportsErr } = await supabaseAdmin
      .from("google_sheet_exports")
      .select("id, marketing_plan_id, status, error_message, updated_at")
      .eq("status", "failed")
      .gte("updated_at", oneHourAgo);

    if (exportsErr) {
      logger.error({ error: exportsErr }, "[HealthMonitor] Error querying failed Google Sheets exports");
    } else if (failedExports && failedExports.length > 0) {
      summary.failedExportsCount = failedExports.length;
      for (const exp of failedExports) {
        const details = `Google Sheets export failed: ${exp.error_message || "Unknown export error"}`;
        await sendAlertWebhook({
          type: "SHEETS_EXPORT_FAILURE",
          jobId: "N/A",
          planId: exp.marketing_plan_id || "N/A",
          details,
          timestamp: now.toISOString(),
        });
        summary.alertsTriggered.push({ type: "SHEETS_EXPORT_FAILURE", planId: exp.marketing_plan_id, details });
      }
    }

    logger.info(
      {
        stuckJobs: summary.stuckJobsCount,
        failedJobs: summary.failedJobsCount,
        totalJobs: summary.totalJobsLastHour,
        failureRate: `${summary.failureRate.toFixed(1)}%`,
        failedExports: summary.failedExportsCount,
        alertsSent: summary.alertsTriggered.length,
      },
      `[HealthMonitor] Completed health check. ${summary.alertsTriggered.length} alert(s) dispatched.`
    );

    return summary;
  } catch (err) {
    logger.error({ error: err.message }, "[HealthMonitor] Unhandled error during health monitoring execution");
    await sendAlertWebhook({
      type: "SYSTEM_ERROR",
      details: `Health monitoring script crashed: ${err.message}`,
      timestamp: now.toISOString(),
    });
    throw err;
  }
}

// Allow direct CLI execution: `node backend/src/scripts/monitor-health.js`
if (process.argv[1] && process.argv[1].endsWith("monitor-health.js")) {
  runHealthMonitoringChecks()
    .then((res) => {
      console.log("\n--- Health Monitoring Result ---");
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n❌ Health monitor script execution failed:", err);
      process.exit(1);
    });
}
