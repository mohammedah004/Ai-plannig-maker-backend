import { z } from "zod";

/**
 * Valid Enums
 */
export const POST_TYPE_ENUM = ["reel", "carousel", "static_post", "story"];
export const CONTENT_OBJECTIVE_ENUM = [
  "awareness",
  "education",
  "engagement",
  "trust",
  "social_proof",
  "objection_handling",
  "conversion",
];
export const EDIT_SOURCE_ENUM = ["manual", "ai_scoped", "external_ai"];

/**
 * Leaf field keys permitted inside a single-day changes object
 */
export const ALLOWED_TOP_LEVEL_MUTATION_FIELDS = [
  "caption",
  "design_copy",
  "post_type",
  "content_objective",
  "content_pillar",
  "design_reference",
  "cta",
];

/**
 * Design Copy Schema
 */
export const designCopyMutationSchema = z
  .object({
    headline: z.string().trim().max(300, "العنوان في التصميم طويل جداً (300 حرف كحد أقصى).").optional(),
    subtext: z.string().trim().max(1000, "النص الفرعي طويل جداً (1000 حرف كحد أقصى).").optional(),
    cta: z.string().trim().max(200, "الدعوة للإجراء في التصميم طويلة جداً (200 حرف كحد أقصى).").optional(),
  })
  .strict();

/**
 * Changes payload schema for a single day
 */
export const dayChangesSchema = z
  .object({
    caption: z.string().trim().max(4000, "الكابشن طويل جداً (4000 حرف كحد أقصى).").optional(),
    design_copy: designCopyMutationSchema.optional(),
    post_type: z.enum(POST_TYPE_ENUM, {
      errorMap: () => ({ message: "نوع القالب غير صالح (يجب أن يكون reel أو carousel أو static_post أو story)." }),
    }).optional(),
    content_objective: z.enum(CONTENT_OBJECTIVE_ENUM, {
      errorMap: () => ({ message: "الهدف التسويقي غير معتمد." }),
    }).optional(),
    content_pillar: z.string().trim().max(100, "الركيزة طويلة جداً (100 حرف كحد أقصى).").optional(),
    design_reference: z.string().trim().max(1000, "التوجيه البصري طويل جداً (1000 حرف كحد أقصى).").optional(),
    cta: z.string().trim().max(300, "الدعوة للإجراء طويلة جداً (300 حرف كحد أقصى).").optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: "يجب تقديم حقل واحد على الأقل لتحديثه.",
  });

/**
 * Single-Day Mutation Request Body (PATCH /api/v1/plans/:id/content/:day)
 */
export const singleDayMutationSchema = z
  .object({
    expectedRevision: z.number().int().min(1, "رقم المراجعة المتوقع غير صالح."),
    expectedPlanVersion: z.number().int().min(1, "رقم إصدار الخطة المتوقع غير صالح."),
    editSource: z.enum(EDIT_SOURCE_ENUM, {
      errorMap: () => ({ message: "مصدر التعديل غير معتمد." }),
    }),
    changes: dayChangesSchema,
  })
  .strict();

/**
 * Batch Mutation Item Schema
 */
export const batchItemSchema = z
  .object({
    day_number: z.number().int().min(1).max(30, "رقم اليوم يجب أن يكون بين 1 و 30."),
    expected_revision: z.number().int().min(1, "رقم المراجعة المتوقع غير صالح."),
    changes: dayChangesSchema,
  })
  .strict();

/**
 * Batch Mutation Request Body (POST /api/v1/plans/:id/content/batch)
 * Includes Blocker B02 duplicate day rejection and Blocker B15 non-empty batch assertion.
 */
export const batchMutationSchema = z
  .object({
    expectedPlanVersion: z.number().int().min(1, "رقم إصدار الخطة المتوقع غير صالح."),
    editSource: z.enum(EDIT_SOURCE_ENUM, {
      errorMap: () => ({ message: "مصدر التعديل غير معتمد." }),
    }),
    batch: z
      .array(batchItemSchema)
      .min(1, "لا يحتوي طلب التعديل على أي أيام لتحديثها.")
      .refine(
        (items) => {
          const days = items.map((i) => i.day_number);
          return new Set(days).size === days.length;
        },
        {
          message: "يحتوي طلب التعديل على أيام مكررة. يجب تضمين كل يوم مرة واحدة فقط.",
        }
      ),
  })
  .strict();

/**
 * Single-Day Undo Request Body (POST /api/v1/plans/:id/content/:day/undo)
 */
export const undoMutationSchema = z
  .object({
    expectedRevision: z.number().int().min(1, "رقم المراجعة المتوقع غير صالح."),
    expectedPlanVersion: z.number().int().min(1, "رقم إصدار الخطة المتوقع غير صالح."),
  })
  .strict();
