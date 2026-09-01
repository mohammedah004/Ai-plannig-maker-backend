import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";

/**
 * Unified Google Gemini AI Service Client (using official unified @google/genai SDK)
 * Features: Structured JSON output, exponential backoff retries, and typed errors.
 */
export class GeminiService {
  constructor(apiKey = env.GEMINI_API_KEY) {
    this.apiKey = apiKey;
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  /**
   * Generates structured JSON output with automatic retries on transient errors.
   *
   * @param {Object} params
   * @param {string} params.systemPrompt - System instruction / prompt
   * @param {string} params.userPrompt - User prompt content
   * @param {Object} [params.responseSchema] - Optional JSON schema for Gemini structured output
   * @param {number} [params.temperature=0.7] - Sampling temperature
   * @param {number} [params.maxRetries=3] - Maximum retry attempts
   * @returns {Promise<any>} Parsed JSON object
   */
  async generateStructuredJSON({
    systemPrompt,
    userPrompt,
    responseSchema = null,
    temperature = 0.7,
    maxRetries = 3,
  }) {
    if (!this.ai) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey || env.GEMINI_API_KEY });
    }

    const config = {
      systemInstruction: systemPrompt,
      temperature,
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
    };

    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents: userPrompt,
          config,
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini returned an empty text response.");
        }

        try {
          return JSON.parse(text);
        } catch (parseErr) {
          // If response contained markdown fences or preamble, extract JSON block
          const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
          throw new Error(`Failed to parse AI output as JSON: ${text.slice(0, 120)}...`);
        }
      } catch (err) {
        lastError = err;
        const statusCode = err.status || err.statusCode;
        const isClientError = statusCode >= 400 && statusCode < 500 && statusCode !== 429;

        // Never retry client misconfiguration errors (400, 401, 403)
        if (isClientError) {
          logger.error({ err: err.message, statusCode }, "[GeminiService] Non-retryable client error");
          throw new AppError(
            "AI_SERVICE_ERROR",
            `خطأ في إعدادات الاتصال بالذكاء الاصطناعي: ${err.message}`,
            500,
            err
          );
        }

        logger.warn(
          { attempt, maxRetries, err: err.message },
          `[GeminiService] Transient error encountered, retrying in ${Math.pow(2, attempt - 1)}s...`
        );

        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt - 1) * 1000;
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }

    logger.error({ lastError: lastError?.message }, "[GeminiService] All retry attempts exhausted");
    throw new AppError(
      "AI_SERVICE_ERROR",
      "تعذر إكمال التوليد بالذكاء الاصطناعي بعد عدة محاولات. يرجى المحاولة لاحقاً.",
      500,
      lastError
    );
  }
}

export const geminiService = new GeminiService();
