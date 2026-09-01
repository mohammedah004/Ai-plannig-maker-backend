import { z } from "zod";

/**
 * Stage 1: Strategy & Diagnosis Schema
 */
export const strategySchema = z.object({
  target_audience_analysis: z.string().min(1),
  pain_points: z.array(z.string()).min(1),
  desired_outcomes: z.array(z.string()).min(1),
  positioning: z.string().min(1),
  messaging_angles: z.array(z.string()).min(1),
  cta_strategy: z.string().min(1),
  diagnosis: z.object({
    marketing_maturity: z.enum(["early_stage", "growing", "established"]).default("early_stage"),
    maturity_reasoning: z.string().min(1),
    top_priorities: z.array(z.string()).min(1),
    instagram_fit_score: z.number().int().min(1).max(10).default(8),
    instagram_fit_reasoning: z.string().min(1),
    key_risks: z.array(z.string()).min(1),
    realistic_expectations: z.string().min(1),
    strategic_assumptions: z.array(z.string()).min(1),
  }),
});

/**
 * Stage 2: Content Pillars & Objective Distribution Schema
 */
export const pillarsSchema = z.object({
  content_pillars: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        percentage: z.number().min(0).max(100),
      })
    )
    .min(1),
  objective_distribution: z.object({
    awareness: z.number().min(0).max(100).default(20),
    education: z.number().min(0).max(100).default(20),
    engagement: z.number().min(0).max(100).default(15),
    trust: z.number().min(0).max(100).default(15),
    social_proof: z.number().min(0).max(100).default(10),
    objection_handling: z.number().min(0).max(100).default(10),
    conversion: z.number().min(0).max(100).default(10),
  }),
});

/**
 * Single Content Item Schema
 */
export const contentItemSchema = z.object({
  day_number: z.coerce.number().int().min(1).max(30).default(1),
  caption: z.string().min(1),
  design_copy: z
    .object({
      headline: z.string().default(""),
      subtext: z.string().default(""),
      cta: z.string().default(""),
    })
    .default({ headline: "", subtext: "", cta: "" }),
  post_type: z.enum(["reel", "carousel", "static_post", "story"]).default("reel"),
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
    .default("awareness"),
  content_pillar: z.string().default("General"),
  design_reference: z.string().default(""),
  cta: z.string().default(""),
});

/**
 * Stage 3: 30-Day Content Calendar Schema
 * Handles both { content_items: [...] } object and [...] raw array from Gemini
 */
export const calendarSchema = z.preprocess((val) => {
  if (Array.isArray(val)) {
    return { content_items: val };
  }
  if (val && typeof val === "object" && !Array.isArray(val.content_items)) {
    const alternate = val.calendar || val.items || val.posts || val.contentItems || val.days;
    if (Array.isArray(alternate)) {
      return { content_items: alternate };
    }
  }
  return val;
}, z.object({
  content_items: z.array(contentItemSchema).min(1).max(30),
}));

/**
 * Single Post Regeneration Schema
 */
export const singlePostRegenerationSchema = z.object({
  caption: z.string().min(1),
  design_copy: z.object({
    headline: z.string().default(""),
    subtext: z.string().default(""),
    cta: z.string().default(""),
  }),
  post_type: z.enum(["reel", "carousel", "static_post", "story"]).default("reel"),
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
    .default("awareness"),
  content_pillar: z.string().min(1),
  design_reference: z.string().min(1),
  cta: z.string().min(1),
});
