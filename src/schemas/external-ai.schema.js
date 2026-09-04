import { z } from "zod";
import {
  POST_TYPE_ENUM,
  CONTENT_OBJECTIVE_ENUM,
  designCopyMutationSchema,
} from "./mutations.schema.js";

/**
 * Return contract schema for external AI when editing a single day.
 * Must be strictly validated to prevent external injection (Blocker B06).
 */
export const externalAiSingleDayContractSchema = z
  .object({
    mode: z.literal("single_day"),
    day: z.number().int().min(1).max(30),
    summary: z.string().trim().max(1000).optional().default(""),
    changes: z
      .object({
        caption: z.string().trim().max(4000).optional(),
        design_copy: designCopyMutationSchema.optional(),
        post_type: z.enum(POST_TYPE_ENUM).optional(),
        content_objective: z.enum(CONTENT_OBJECTIVE_ENUM).optional(),
        content_pillar: z.string().trim().max(100).optional(),
        design_reference: z.string().trim().max(1000).optional(),
        cta: z.string().trim().max(300).optional(),
      })
      .strict()
      .refine((val) => Object.keys(val).length > 0, {
        message: "يجب تقديم حقل تعديل واحد على الأقل داخل changes.",
      }),
  })
  .strict();

/**
 * Day item inside multi_day return contract
 */
export const externalAiMultiDayItemSchema = z
  .object({
    day: z.number().int().min(1).max(30),
    changes: z
      .object({
        caption: z.string().trim().max(4000).optional(),
        design_copy: designCopyMutationSchema.optional(),
        post_type: z.enum(POST_TYPE_ENUM).optional(),
        content_objective: z.enum(CONTENT_OBJECTIVE_ENUM).optional(),
        content_pillar: z.string().trim().max(100).optional(),
        design_reference: z.string().trim().max(1000).optional(),
        cta: z.string().trim().max(300).optional(),
      })
      .strict()
      .refine((val) => Object.keys(val).length > 0, {
        message: "يجب تقديم حقل تعديل واحد على الأقل داخل changes لكل يوم.",
      }),
  })
  .strict();

/**
 * Return contract schema for external AI when editing multiple days.
 */
export const externalAiMultiDayContractSchema = z
  .object({
    mode: z.literal("multi_day"),
    summary: z.string().trim().max(1500).optional().default(""),
    days: z
      .array(externalAiMultiDayItemSchema)
      .min(1, "يجب تضمين يوم واحد على الأقل داخل مصفوفة days.")
      .refine(
        (items) => {
          const days = items.map((i) => i.day);
          return new Set(days).size === days.length;
        },
        {
          message: "يحتوي الرد على أيام مكررة. يجب أن يكون كل يوم فريداً.",
        }
      ),
  })
  .strict();

/**
 * Request payload to POST /api/v1/plans/:id/external-ai/parse
 */
export const externalAiParseRequestSchema = z
  .object({
    mode: z.enum(["single_day", "multi_day"], {
      errorMap: () => ({ message: "وضع التحليل يجب أن يكون single_day أو multi_day." }),
    }),
    day: z.number().int().min(1).max(30).optional(),
    raw_response: z
      .string({ required_error: "يرجى تقديم رد الذكاء الاصطناعي لتحليله." })
      .min(2, "رد الذكاء الاصطناعي قصير جداً.")
      .max(50000, "رد الذكاء الاصطناعي تجاوز الحد الأقصى المسموح به (50,000 حرف)."),
  })
  .strict()
  .refine(
    (data) => {
      if (data.mode === "single_day") {
        return typeof data.day === "number";
      }
      return true;
    },
    {
      message: "رقم اليوم مطلوب عند اختيار وضع single_day.",
      path: ["day"],
    }
  );
