import { sendError } from "../utils/response.js";

/**
 * Zod Request Body Validation Middleware Factory
 *
 * @param {import("zod").ZodSchema} schema - Zod schema to validate against
 * @returns {import("express").RequestHandler}
 */
export function validate(schema) {
  return async (req, res, next) => {
    try {
      const result = await schema.safeParseAsync(req.body);

      if (!result.success) {
        const fieldErrors = {};
        result.error.errors.forEach((err) => {
          const path = err.path.length > 0 ? err.path.join(".") : "_form";
          if (!fieldErrors[path]) {
            fieldErrors[path] = err.message;
          }
        });

        return sendError(
          res,
          "VALIDATION_ERROR",
          "يرجى مراجعة الحقول المدخلة والتأكد من صحتها.",
          400,
          fieldErrors
        );
      }

      // Replace req.body with the sanitized and coerced data
      req.body = result.data;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
