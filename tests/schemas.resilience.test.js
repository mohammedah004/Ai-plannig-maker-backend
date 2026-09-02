import { describe, it, expect } from "vitest";
import { calendarSchema, contentItemSchema } from "../src/services/ai/schemas.js";

describe("AI Schema Resilience Tests", () => {
  const samplePost = {
    day_number: 1,
    caption: "نص تجريبي للمنشور في اليوم الأول",
    design_copy: {
      headline: "عنوان جذاب",
      subtext: "نص فرعي توضيحي",
      cta: "سجل الآن",
    },
    post_type: "reel",
    content_objective: "awareness",
    content_pillar: "توعية عامة",
    design_reference: "فيديو ريلز ديناميكي مع إضاءة سينمائية",
    cta: "اشترك في القائمة البريدية",
  };

  it("Parses standard object schema { content_items: [...] } successfully", () => {
    const input = {
      content_items: [samplePost],
    };
    const parsed = calendarSchema.parse(input);
    expect(parsed.content_items).toHaveLength(1);
    expect(parsed.content_items[0].caption).toBe(samplePost.caption);
  });

  it("Parses raw Array [...] directly from Gemini without throwing ZodError", () => {
    const input = [samplePost, { ...samplePost, day_number: 2 }];
    const parsed = calendarSchema.parse(input);
    expect(parsed.content_items).toHaveLength(2);
    expect(parsed.content_items[0].day_number).toBe(1);
    expect(parsed.content_items[1].day_number).toBe(2);
  });

  it("Parses alternative object key wrapping like { calendar: [...] } or { items: [...] }", () => {
    const inputCalendar = { calendar: [samplePost] };
    const parsedCalendar = calendarSchema.parse(inputCalendar);
    expect(parsedCalendar.content_items).toHaveLength(1);

    const inputItems = { items: [samplePost] };
    const parsedItems = calendarSchema.parse(inputItems);
    expect(parsedItems.content_items).toHaveLength(1);
  });

  it("Coerces string day_number and applies fallback defaults on partial fields", () => {
    const looseItem = {
      day_number: "5",
      caption: "كابشن المنشور الخامس",
    };
    const parsed = contentItemSchema.parse(looseItem);
    expect(parsed.day_number).toBe(5);
    expect(parsed.post_type).toBe("reel");
    expect(parsed.content_objective).toBe("awareness");
    expect(parsed.design_copy.headline).toBe("");
  });
});

describe("GeminiService API Key Rotation Tests", () => {
  it("Parses comma-separated process.env.GEMINI_API_KEYS and rotates keys round-robin", async () => {
    const { GeminiService } = await import("../src/services/ai/gemini.service.js");
    const service = new GeminiService("key1, key2, key3");

    expect(service.getApiKeys()).toEqual(["key1", "key2", "key3"]);
    expect(service.apiKey).toBe("key1");

    expect(service.rotateKey()).toBe("key2");
    expect(service.apiKey).toBe("key2");

    expect(service.rotateKey()).toBe("key3");
    expect(service.apiKey).toBe("key3");

    expect(service.rotateKey()).toBe("key1");
    expect(service.apiKey).toBe("key1");
  });

  it("Supports JSON array strings in GEMINI_API_KEYS", async () => {
    const { GeminiService } = await import("../src/services/ai/gemini.service.js");
    const service = new GeminiService('["keyA", "keyB"]');

    expect(service.getApiKeys()).toEqual(["keyA", "keyB"]);
    expect(service.apiKey).toBe("keyA");
    expect(service.rotateKey()).toBe("keyB");
  });

  it("Falls back smoothly to single key if only one key is provided", async () => {
    const { GeminiService } = await import("../src/services/ai/gemini.service.js");
    const service = new GeminiService("single_key_123");

    expect(service.getApiKeys()).toEqual(["single_key_123"]);
    expect(service.apiKey).toBe("single_key_123");
    expect(service.rotateKey()).toBe("single_key_123");
  });
});
