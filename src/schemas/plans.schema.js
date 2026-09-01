import { z } from "zod";

/**
 * Schema for POST /api/v1/plans (Create Marketing Plan)
 */
export const createPlanSchema = z.object({
  product_name: z
    .string({ required_error: "يرجى كتابة اسم المنتج أو البراند." })
    .trim()
    .min(2, "اسم المنتج يجب أن يتكون من حرفين على الأقل.")
    .max(120, "اسم المنتج طويل جداً (الحد الأقصى 120 حرفاً)."),

  product_description: z
    .string({ required_error: "يرجى كتابة وصف تفصيلي للمنتج أو الخدمة." })
    .trim()
    .min(10, "يرجى تقديم تفاصيل أكثر عن المنتج (10 أحرف على الأقل).")
    .max(2000, "وصف المنتج طويل جداً (الحد الأقصى 2000 حرف)."),

  product_category: z
    .string({ required_error: "يرجى اختيار تصنيف صالح للمنتج." })
    .trim()
    .min(1, "يرجى اختيار تصنيف صالح للمنتج."),

  target_audience: z
    .string({ required_error: "يرجى تحديد الشريحة والجمهور المستهدف." })
    .trim()
    .min(5, "يرجى وصف الجمهور المستهدف بتفاصيل أكثر (5 أحرف على الأقل).")
    .max(1000, "وصف الجمهور طويل جداً (الحد الأقصى 1000 حرف)."),

  problem_solved: z
    .string({ required_error: "يرجى شرح المشكلة التي يحلها المنتج أو القيمة المقدمة." })
    .trim()
    .min(5, "يرجى شرح المشكلة بتفاصيل أوضح (5 أحرف على الأقل).")
    .max(1000, "شرح المشكلة طويل جداً (الحد الأقصى 1000 حرف)."),

  marketing_objective: z
    .string({ required_error: "يرجى اختيار الهدف التسويقي للخطة." })
    .trim()
    .min(1, "يرجى اختيار الهدف التسويقي للخطة."),

  brand_tone: z
    .array(z.string().trim(), {
      required_error: "يرجى اختيار نبرة براند واحدة على الأقل.",
      invalid_type_error: "نبرة البراند يجب أن تكون قائمة نصوص.",
    })
    .min(1, "يرجى اختيار نبرة براند واحدة على الأقل.")
    .max(3, "يمكنك اختيار 3 نبرات كحد أقصى."),

  website_url: z
    .string()
    .trim()
    .max(500, "الرابط طويل جداً (الحد الأقصى 500 حرف).")
    .nullable()
    .optional()
    .transform((val) => {
      if (!val) return null;
      try {
        const normalized = val.startsWith("http://") || val.startsWith("https://") ? val : `https://${val}`;
        new URL(normalized);
        return normalized;
      } catch {
        return val;
      }
    }),

  additional_context: z
    .string()
    .trim()
    .max(2000, "الملاحظات الإضافية طويلة جداً (الحد الأقصى 2000 حرف).")
    .nullable()
    .optional()
    .transform((val) => val || null),

  brand_profile_id: z
    .string()
    .uuid("معرف ملف البراند غير صالح.")
    .nullable()
    .optional()
    .transform((val) => val || null),
});

/**
 * Schema for POST /api/v1/plans/:id/content/:day/regenerate
 */
export const regeneratePostSchema = z.object({
  instruction: z
    .string()
    .trim()
    .max(500, "التعليمات المخصصة طويلة جداً (الحد الأقصى 500 حرف).")
    .optional()
    .default(""),
  post_type: z
    .enum(["reel", "carousel", "static_post", "story"])
    .optional()
    .nullable(),
  content_objective: z
    .enum([
      "awareness",
      "education",
      "engagement",
      "trust",
      "social_proof",
      "objection_handling",
      "conversion",
    ])
    .optional()
    .nullable(),
});
