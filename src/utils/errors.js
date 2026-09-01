/**
 * Base Application Error
 */
export class AppError extends Error {
  /**
   * @param {string} code - Internal error code (e.g. VALIDATION_ERROR, NOT_FOUND)
   * @param {string} message - User-facing Arabic error message
   * @param {number} statusCode - HTTP status code
   * @param {any} details - Additional context or field-specific errors
   */
  constructor(code, message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = "يرجى مراجعة الحقول المدخلة والتأكد من صحتها.", details = null) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "يجب تسجيل الدخول للوصول إلى هذه الخدمة.") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "ليس لديك الصلاحية لتنفيذ هذا الإجراء.") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "العنصر المطلوب غير موجود.") {
    super("NOT_FOUND", message, 404);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "تم تجاوز الحد المسموح به من الطلبات. يرجى المحاولة لاحقاً.", details = null) {
    super("RATE_LIMIT_EXCEEDED", message, 429, details);
  }
}
