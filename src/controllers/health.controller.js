import { sendSuccess } from "../utils/response.js";
import { env } from "../config/env.js";

/**
 * Health Check Controller
 * Public endpoint used for Render Free warm-up pings and monitoring.
 */
export function getHealth(req, res) {
  const data = {
    status: "ok",
    service: "ai-marketing-planner-backend",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  };

  return sendSuccess(res, data, 200, "Service is healthy and ready.");
}
