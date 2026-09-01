import { z } from "zod";

/**
 * Schema for POST /api/v1/brands (Create Brand Profile)
 */
export const createBrandSchema = z.object({
  name: z
    .string({ required_error: "يرجى كتابة اسم تعريفي لملف البراند." })
    .trim()
    .min(2, "اسم الملف التعريفي يجب أن يتكون من حرفين على الأقل.")
    .max(100, "اسم الملف التعريفي طويل جداً (الحد الأقصى 100 حرف)."),

  product_name: z
    .string({ required_error: "يرجى كتابة اسم المنتج أو البراند." })
    .trim()
    .min(2, "اسم المنتج يجب أن يتكون من حرفين على الأقل.")
    .max(120, "اسم المنتج طويل جداً (الحد الأقصى 120 حرفاً)."),

  product_description: z
    .string({ required_error: "يرجى كتابة وصف تفصيلي للمنتج أو البراند." })
    .trim()
    .min(10, "يرجى تقديم تفاصيل أكثر عن المنتج (10 أحرف على الأقل).")
    .max(2000, "وصف المنتج طويل جداً (الحد الأقصى 2000 حرف)."),

  product_category: z
    .string({ required_error: "يرجى اختيار تصنيف صالح للبراند." })
    .trim()
    .min(1, "يرجى اختيار تصنيف صالح للبراند."),

  target_audience: z
    .string({ required_error: "يرجى توضيح الشريحة والجمهور المستهدف." })
    .trim()
    .min(5, "يرجى وصف الجمهور المستهدف بتفاصيل أكثر (5 أحرف على الأقل).")
    .max(1000, "وصف الجمهور طويل جداً (الحد الأقصى 1000 حرف)."),

  problem_solved: z
    .string({ required_error: "يرجى شرح المشكلة أو القيمة التي يقدمها البراند." })
    .trim()
    .min(5, "يرجى شرح المشكلة بتفاصيل أوضح (5 أحرف على الأقل).")
    .max(1000, "شرح المشكلة طويل جداً (الحد الأقصى 1000 حرف)."),

  brand_tone: z
    .array(z.string().trim(), {
      required_error: "يرجى اختيار نبرة براند واحدة على الأقل.",
      invalid_type_error: "نبرة البراند يجب أن تكون قائمة نصوص.",
    })
    .min(1, "يرجى اختيار نبرة براند واحدة على الأقل.")
    .max(3, "يمكنك اختيار 3 نبرات كحد أقصى."),

  website_url: z
    .string({ invalid_type_error: "رابط الموقع يجب أن يكون نصاً." })
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
    .string({ invalid_type_error: "الملاحظات الإضافية يجب أن تكون نصاً." })
    .trim()
    .max(2000, "الملاحظات الإضافية طويلة جداً (الحد الأقصى 2000 حرف).")
    .nullable()
    .optional()
    .transform((val) => val || null),

  is_default: z
    .boolean({ invalid_type_error: "قيمة is_default يجب أن تكون boolean." })
    .optional()
    .default(false),
});

/**
 * Schema for PUT /api/v1/brands/:id (Update Brand Profile)
 * All fields are optional, but at least one field must be provided.
 */
export const updateBrandSchema = createBrandSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "يجب تقديم حقل واحد على الأقل للتحديث.",
  });
