import { AppError } from "../utils/errors.js";
import { sendError } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

/**
 * Global Express Error Handling Middleware
 */
export function errorHandler(err, req, res, next) {
  // Operational errors created deliberately via AppError
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path, method: req.method }, `[AppError 500] ${err.message}`);
    } else {
      logger.warn({ code: err.code, path: req.path, method: req.method }, `[AppError ${err.statusCode}] ${err.message}`);
    }

    return sendError(res, err.code, err.message, err.statusCode, err.details);
  }

  // Zod validation errors
  if (err?.name === "ZodError") {
    const formattedFields = {};
    err.errors?.forEach((e) => {
      const field = e.path.join(".");
      formattedFields[field] = e.message;
    });

    return sendError(
      res,
      "VALIDATION_ERROR",
      "يرجى مراجعة الحقول المدخلة والتأكد من صحتها.",
      400,
      formattedFields
    );
  }

  // Body parser syntax error (invalid JSON)
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return sendError(
      res,
      "INVALID_JSON",
      "صيغة JSON غير صالحة في جسم الطلب.",
      400
    );
  }

  // Unexpected runtime exceptions (Log full stack trace server-side, never leak to client)
  logger.error(
    {
      err: {
        message: err?.message,
        stack: err?.stack,
        name: err?.name,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    },
    "[Unhandled Server Exception]"
  );

  const userMessage =
    env.NODE_ENV === "development"
      ? err.message || "حدث خطأ غير متوقع في السيرفر."
      : "حدث خطأ غير متوقع في معالجة طلبك. يرجى المحاولة مرة أخرى.";

  return sendError(res, "INTERNAL_SERVER_ERROR", userMessage, 500);
}
