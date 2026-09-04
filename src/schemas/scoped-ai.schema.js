import { z } from "zod";
import {
  POST_TYPE_ENUM,
  CONTENT_OBJECTIVE_ENUM,
} from "./mutations.schema.js";

/**
 * 9 Standardized Leaf Fields (Blocker B09)
 */
export const LEAF_FIELDS = [
  "caption",
  "design_copy.headline",
  "design_copy.subtext",
  "design_copy.cta",
  "post_type",
  "content_objective",
  "content_pillar",
  "design_reference",
  "cta",
];

/**
 * Valid scopes allowed in Scoped AI request
 */
export const VALID_SCOPES = [
  ...LEAF_FIELDS,
  "entire_post",
  "design_copy", // Convenience scope that maps to all 3 design_copy leaf fields
];

/**
 * Request payload schema for POST /api/v1/plans/:id/content/:day/scoped-ai
 */
export const scopedAiRequestSchema = z
  .object({
    scope: z
      .array(z.string().trim())
      .min(1, "يرجى تحديد نطاق واحد على الأقل للتعديل.")
      .refine(
        (items) => items.every((s) => VALID_SCOPES.includes(s)),
        {
          message: "النطاق المحدد يحتوي على حقول غير معتمدة.",
        }
      ),
    instruction: z
      .string({ required_error: "يرجى كتابة تعليمات التعديل المطلوبة." })
      .trim()
      .min(2, "يرجى كتابة تعليمات واضحة (حرفين على الأقل).")
      .max(1000, "تعليمات التعديل طويلة جداً (الحد الأقصى 1000 حرف)."),
    expectedRevision: z.number().int().min(1, "رقم المراجعة المتوقع غير صالح."),
    expectedPlanVersion: z.number().int().min(1, "رقم إصدار الخطة المتوقع غير صالح."),
  })
  .strict();

/**
 * Dynamically builds a strict Zod schema enforcing fail-closed bounds (Blockers B08, B09).
 * If the AI returns fields not authorized in requestedScope, validation fails.
 *
 * @param {string[]} requestedScope
 * @returns {z.ZodObject}
 */
export function buildStrictScopedOutputSchema(requestedScope = []) {
  const isEntirePost = requestedScope.includes("entire_post");
  const includesDesignCopy = isEntirePost || requestedScope.includes("design_copy");

  const shape = {};

  if (isEntirePost || requestedScope.includes("caption")) {
    shape.caption = z.string().trim().max(4000);
  }

  // Handle design_copy sub-fields
  const designShape = {};
  if (includesDesignCopy || requestedScope.includes("design_copy.headline")) {
    designShape.headline = z.string().trim().max(300);
  }
  if (includesDesignCopy || requestedScope.includes("design_copy.subtext")) {
    designShape.subtext = z.string().trim().max(1000);
  }
  if (includesDesignCopy || requestedScope.includes("design_copy.cta")) {
    designShape.cta = z.string().trim().max(200);
  }

  if (Object.keys(designShape).length > 0) {
    shape.design_copy = z.object(designShape).strict();
  }

  if (isEntirePost || requestedScope.includes("post_type")) {
    shape.post_type = z.enum(POST_TYPE_ENUM);
  }

  if (isEntirePost || requestedScope.includes("content_objective")) {
    shape.content_objective = z.enum(CONTENT_OBJECTIVE_ENUM);
  }

  if (isEntirePost || requestedScope.includes("content_pillar")) {
    shape.content_pillar = z.string().trim().max(100);
  }

  if (isEntirePost || requestedScope.includes("design_reference")) {
    shape.design_reference = z.string().trim().max(1000);
  }

  if (isEntirePost || requestedScope.includes("cta")) {
    shape.cta = z.string().trim().max(300);
  }

  // Summary is always allowed from AI
  shape.summary = z.string().trim().max(1000).optional();

  return z.object(shape).strict();
}
