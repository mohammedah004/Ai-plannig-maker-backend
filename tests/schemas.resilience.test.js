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
