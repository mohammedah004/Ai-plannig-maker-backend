import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";

/**
 * Unified Google Gemini AI Service Client (using official unified @google/genai SDK)
 * Features: Multi-key rotation (GEMINI_API_KEYS), structured JSON output, exponential backoff retries, and typed errors.
 */
export class GeminiService {
  constructor(apiKeysInput = null) {
    this.rawKeysInput = apiKeysInput;
    this.clients = new Map();
    this.currentIndex = 0;
    this.modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  /**
   * Helper to parse API keys from constructor argument or environment variables.
   * Supports comma-separated list in process.env.GEMINI_API_KEYS, arrays, or single GEMINI_API_KEY.
   * @returns {string[]}
   */
  getApiKeys() {
    const raw =
      this.rawKeysInput ||
      process.env.GEMINI_API_KEYS ||
      process.env.GEMINI_API_KEY ||
      env.GEMINI_API_KEY ||
      env.GEMINI_API_KEYS;

    if (Array.isArray(raw)) {
      return raw.map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean);
    }

    if (typeof raw === "string" && raw.trim()) {
      try {
        if (raw.trim().startsWith("[") && raw.trim().endsWith("]")) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean);
          }
        }
      } catch {
        // Fall back to comma splitting if JSON parse fails
      }

      return raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    }

    return [];
  }

  /**
   * Returns the current active API key in rotation.
   * @returns {string|null}
   */
  get apiKey() {
    const keys = this.getApiKeys();
    if (keys.length === 0) return null;
    return keys[this.currentIndex % keys.length];
  }

  /**
   * Sets or overrides the current API key/keys.
   */
  set apiKey(value) {
    this.rawKeysInput = value;
    this.clients.clear();
    this.currentIndex = 0;
  }

  /**
   * Returns the active GoogleGenAI client instance for the current key.
   * @returns {GoogleGenAI|null}
   */
  get ai() {
    return this.getClient(this.apiKey);
  }

  /**
   * Sets or overrides the AI client directly (e.g. in test mocks).
   */
  set ai(clientInstance) {
    if (this.apiKey) {
      this.clients.set(this.apiKey, clientInstance);
    } else {
      this.clients.set("__default__", clientInstance);
    }
  }

  /**
   * Retrieves or instantiates a GoogleGenAI SDK client for a given key.
   * @param {string} key
   * @returns {GoogleGenAI|null}
   */
  getClient(key) {
    if (!key) {
      if (this.clients.has("__default__")) {
        return this.clients.get("__default__");
      }
      return null;
    }
    if (!this.clients.has(key)) {
      this.clients.set(key, new GoogleGenAI({ apiKey: key }));
    }
    return this.clients.get(key);
  }

  /**
   * Rotates to the next available API key in round-robin fashion.
   * @returns {string|null} The next API key
   */
  rotateKey() {
    const keys = this.getApiKeys();
    if (keys.length <= 1) {
      return this.apiKey;
    }
    this.currentIndex = (this.currentIndex + 1) % keys.length;
    const nextKey = keys[this.currentIndex];
    const maskedKey = nextKey ? `...${nextKey.slice(-4)}` : "unknown";
    logger.info(
      `[GeminiService] Rotated to API key index ${this.currentIndex} of ${keys.length} (${maskedKey})`
    );
    return nextKey;
  }

  /**
   * Generates structured JSON output with automatic retries, exponential backoff,
   * and API key rotation across requests and upon quota/rate limit errors.
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
    const keys = this.getApiKeys();
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
      const currentKey = this.apiKey;
      const client = this.getClient(currentKey) || (this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null);

      if (!client) {
        throw new AppError(
          "AI_SERVICE_ERROR",
          "مفتاح Gemini API غير متوفر أو غير مهيأ بشكل صحيح (GEMINI_API_KEYS / GEMINI_API_KEY).",
          500
        );
      }

      try {
        const response = await client.models.generateContent({
          model: this.modelName,
          contents: userPrompt,
          config,
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini returned an empty text response.");
        }

        let parsedResult;
        try {
          parsedResult = JSON.parse(text);
        } catch (parseErr) {
          // If response contained markdown fences or preamble, extract JSON block
          const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error(`Failed to parse AI output as JSON: ${text.slice(0, 120)}...`);
          }
        }

        // Advance key rotation on success for balanced distribution across multiple keys
        if (keys.length > 1) {
          this.rotateKey();
        }

        return parsedResult;
      } catch (err) {
        lastError = err;
        const statusCode = err.status || err.statusCode;
        const isQuotaOrRateLimit =
          statusCode === 429 ||
          err.message?.includes("RESOURCE_EXHAUSTED") ||
          err.message?.includes("quota") ||
          err.message?.includes("rate limit");
        const isClientError = statusCode >= 400 && statusCode < 500 && !isQuotaOrRateLimit;

        // If multiple keys are configured, rotate key on failure so retry uses fresh quota
        if (keys.length > 1) {
          this.rotateKey();
        }

        // Never retry non-quota client misconfiguration errors (400, 401, 403)
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
          { attempt, maxRetries, keyIndex: this.currentIndex, err: err.message },
          `[GeminiService] Transient or quota error encountered, retrying in ${Math.pow(2, attempt - 1)}s...`
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
