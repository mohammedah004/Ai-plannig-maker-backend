/**
 * Standard API Success Response Envelope
 *
 * @param {import("express").Response} res
 * @param {any} data - Payload data
 * @param {number} statusCode - HTTP status code (default 200)
 * @param {string|null} message - Optional user-facing message
 */
export function sendSuccess(res, data = null, statusCode = 200, message = null) {
  const payload = {
    success: true,
    data,
  };

  if (message) {
    payload.message = message;
  }

  return res.status(statusCode).json(payload);
}

/**
 * Standard API Error Response Envelope
 *
 * @param {import("express").Response} res
 * @param {string} code - Error code
 * @param {string} message - User-facing message
 * @param {number} statusCode - HTTP status code (default 500)
 * @param {any} details - Additional error details
 */
export function sendError(res, code = "SERVER_ERROR", message = "حدث خطأ غير متوقع.", statusCode = 500, details = null) {
  const payload = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };

  return res.status(statusCode).json(payload);
}
