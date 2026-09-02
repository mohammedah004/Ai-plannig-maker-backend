/**
 * Prompts Builder for 3-Stage AI Marketing Generation Pipeline & Single-Post Regeneration
 */

/**
 * Stage 1: Strategy & Diagnosis Prompts
 */
export function buildStrategyPrompt(plan, previousPlanSummary = null) {
  const systemPrompt = `You are an expert Instagram marketing strategist and business diagnosis advisor. Return ONLY a valid strict JSON object in Arabic without markdown fences.
All textual responses must be professional, high quality, and in Arabic.
marketing_maturity must be one of: "early_stage", "growing", "established".
instagram_fit_score must be an integer between 1 and 10.`;

  const brandMemorySection = previousPlanSummary
    ? `\n### الذاكرة الاستراتيجية للخطة السابقة (Brand Marketing Memory):
- الهدف التسويقي للخطة السابقة: ${previousPlanSummary.previous_objective || "غير محدد"}
- ركائز المحتوى في الخطة السابقة: ${(previousPlanSummary.previous_pillars || []).join(" | ")}
- ملامح التموضع السابق: ${previousPlanSummary.previous_strategy_highlights || "غير محدد"}
👉 توجيه ذاكرة البراند: ابنِ على النجاح والتموضع السابق مع تجديد ركائز وزوايا المحتوى وتقديم قيمة متراكمة وغير مكررة للجمهور.\n`
    : "";

  const tones = Array.isArray(plan.brand_tone) ? plan.brand_tone.join(", ") : (plan.brand_tone || "احترافي");

  const userPrompt = `Analyze this product and diagnose the marketing situation:
Product Name: ${plan.product_name}
Description: ${plan.product_description}
Category: ${plan.product_category}
Target Audience: ${plan.target_audience}
Problem Solved: ${plan.problem_solved}
Marketing Objective: ${plan.marketing_objective}
Brand Tone: ${tones}
Website URL: ${plan.website_url || "غير محدد"}
Additional Context: ${plan.additional_context || "لا توجد ملاحظات إضافية"}
${brandMemorySection}
Return strict JSON matching this structure:
{
  "target_audience_analysis": "تحليل دقيق ومفصل لطبيعة وسلوك الجمهور المستهدف",
  "pain_points": ["نقطة الألم 1", "نقطة الألم 2", "نقطة الألم 3"],
  "desired_outcomes": ["النتيجة المرغوبة 1", "النتيجة المرغوبة 2", "النتيجة المرغوبة 3"],
  "positioning": "صياغة واضحة لتموضع البراند ومكانته في السوق مقارنة بالمنافسين",
  "messaging_angles": ["زاوية الخطاب 1", "زاوية الخطاب 2", "زاوية الخطاب 3"],
  "cta_strategy": "استراتيجية الدعوة لاتخاذ الإجراء المناسبة للمنتج",
  "diagnosis": {
    "marketing_maturity": "early_stage",
    "maturity_reasoning": "سبب تصنيف مرحلة نضج البراند باللغة العربية بناءً على المعطيات والذاكرة التراكمية",
    "top_priorities": ["الأولوية الاستراتيجية الأولى", "الأولوية الثانية", "الأولوية الثالثة"],
    "instagram_fit_score": 8,
    "instagram_fit_reasoning": "شرح مدى ومبررات ملاءمة منصة إنستغرام لجمهور وطبيعة هذا البزنس",
    "key_risks": ["المخاطرة أو التحدي 1", "المخاطرة أو التحدي 2"],
    "realistic_expectations": "توقعات واقعية لما يمكن تحقيقه خلال خطة الـ 30 يوماً القادمة",
    "strategic_assumptions": ["الافتراض الاستراتيجي 1", "الافتراض الاستراتيجي 2"]
  }
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Stage 2: Content Pillars & Objective Distribution Prompts
 */
export function buildPillarsPrompt(plan, strategy) {
  const systemPrompt = `You are an expert Instagram content architect. Return ONLY a valid JSON object without markdown fences.
All text must be in Arabic. Percentages in content_pillars must sum to 100%. Objective distribution must reflect the chosen marketing objective.`;

  const userPrompt = `Based on this strategy:
${typeof strategy === "string" ? strategy : JSON.stringify(strategy, null, 2)}

And marketing objective: ${plan.marketing_objective}

Generate content pillars and objective distribution in strict JSON:
{
  "content_pillars": [
    { "name": "اسم الركيزة", "description": "شرح تفصيلي للركيزة والهدف منها", "percentage": 30 }
  ],
  "objective_distribution": {
    "awareness": 20,
    "education": 20,
    "engagement": 15,
    "trust": 15,
    "social_proof": 10,
    "objection_handling": 10,
    "conversion": 10
  }
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Stage 3: 30-Day Content Calendar Prompts
 */
export function buildCalendarPrompt(plan, strategy, pillars) {
  const systemPrompt = `You are an elite Instagram growth strategist and senior creative copywriter. Output ONLY valid strict JSON without markdown formatting fences.
Return 30 completely distinct, high-impact content items covering days 1 to 30.

CRITICAL PAYLOAD & COMPACTNESS RULES:
1. PUNCHY & CONCISE: To ensure fast, reliable generation without timeouts, keep each field compact, high-density, and free of filler words.
2. CAPTION FORMAT: 2 to 4 concise, high-converting sentences in natural Arabic (Hook + Core Value/Insight + CTA) with 1-2 relevant emojis.
3. DESIGN COPY: Headline (3-6 words), Subtext (under 12 words), Design CTA (2-4 words).
4. DESIGN REFERENCE: 1-2 concise sentences of visual/editorial direction.
5. DIVERSITY: Distribute post types among "reel", "carousel", "static_post", "story" according to objectives. Every day MUST have a unique hook. No placeholder day labels.
6. post_type must be one of: "reel", "carousel", "static_post", "story".
7. content_objective must be one of: "awareness", "education", "engagement", "trust", "social_proof", "objection_handling", "conversion".`;

  const tones = Array.isArray(plan.brand_tone) ? plan.brand_tone.join(", ") : (plan.brand_tone || "احترافي");

  // Compact strategy summary for lean prompt input
  const strategySummary =
    typeof strategy === "object" && strategy !== null
      ? {
          positioning: strategy.positioning,
          audience: strategy.target_audience_analysis,
          messaging_angles: strategy.messaging_angles,
          cta_strategy: strategy.cta_strategy,
        }
      : strategy;

  // Compact pillars summary
  const pillarsSummary =
    typeof pillars === "object" && pillars !== null
      ? {
          pillars: (pillars.content_pillars || []).map((p) => `${p.name} (${p.percentage}%)`),
          distribution: pillars.objective_distribution,
        }
      : pillars;

  const userPrompt = `Generate a compact, high-impact 30-day Instagram content calendar:
Product: ${plan.product_name}
Description: ${plan.product_description}
Audience: ${plan.target_audience}
Brand Tone: ${tones}
Marketing Objective: ${plan.marketing_objective}
Strategy: ${JSON.stringify(strategySummary)}
Pillars: ${JSON.stringify(pillarsSummary)}

Return strict JSON with key "content_items" containing 30 items (days 1 to 30):
{
  "content_items": [
    {
      "day_number": 1,
      "caption": "خطاف قوي ومركز + محتوى تسويقي عميق في 2-3 جمل + دعوة واضحة للتفاعل",
      "design_copy": {
        "headline": "عنوان رئيسي جذاب وقصير (3-6 كلمات)",
        "subtext": "نص مساعد موجز جداً للتصميم",
        "cta": "زر الإجراء"
      },
      "post_type": "reel",
      "content_objective": "awareness",
      "content_pillar": "اسم الركيزة",
      "design_reference": "توجيه بصري وإخراجي موجز في سطرين",
      "cta": "الدعوة للتفاعل في الكابشن"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Single Post Regeneration Prompts
 */
export function buildRegeneratePrompt({
  plan,
  currentItem,
  dayNumber,
  instruction = "",
  requestedPostType = null,
  requestedObjective = null,
}) {
  const targetPostType = requestedPostType || currentItem.post_type || "reel";
  const targetObjective = requestedObjective || currentItem.content_objective || "awareness";
  const targetPillar = currentItem.content_pillar || "الأساس التسويقي";

  const systemPrompt = `أنت خبير استراتيجي أول في التسويق بالمحتوى وكتابة الإعلانات على إنستغرام.
مهمتك: إعادة صياغة وتوليد منشور واحد محدد لليوم رقم (${dayNumber}) ضمن خطة تسويقية لـ 30 يوماً.
يجب الحفاظ على التناغم الاستراتيجي مع هوية البراند والجمهور مع تطبيق تعديلات المستخدم بدقة.
المخرجات يجب أن تكون JSON صارم بدون markdown.`;

  const tones = Array.isArray(plan.brand_tone) ? plan.brand_tone.join(", ") : (plan.brand_tone || "احترافي");

  const userPrompt = `### سياق البراند:
- اسم المنتج/البراند: ${plan.product_name}
- وصف المنتج: ${plan.product_description}
- الجمهور المستهدف: ${plan.target_audience}
- المشكلة المحلولة: ${plan.problem_solved}
- نبرة البراند: ${tones}
- رابط الموقع: ${plan.website_url || "غير محدد"}

### المنشور الحالي لليوم (${dayNumber}):
- نوع المنشور: ${currentItem.post_type}
- الهدف: ${currentItem.content_objective}
- المحور: ${currentItem.content_pillar}
- الكابشن الحالي: ${currentItem.caption}
- العنوان في التصميم: ${currentItem.design_copy?.headline || ""}
- التوجيه البصري: ${currentItem.design_reference}

### التعديلات والتعليمات المطلوبة من المستخدم:
${instruction ? `👉 تعليمات المستخدم الخاصة: "${instruction}"` : "👉 أعد صياغة المنشور بأسلوب أكثر جاذبية وقوة وإقناعاً."}
${requestedPostType ? `👉 تغيير نوع القالب البصري إلى: ${requestedPostType}` : ""}
${requestedObjective ? `👉 تغيير الهدف التسويقي إلى: ${requestedObjective}` : ""}

أعد توليد المنشور بصيغة JSON مطابقة للشكل التالي:
{
  "caption": "نص الكابشن الجديد الجذاب مع إيموجي وخطاف قوي",
  "design_copy": {
    "headline": "العنوان الرئيسي في التصميم",
    "subtext": "النص المساعد في التصميم",
    "cta": "زر الإجراء في التصميم"
  },
  "post_type": "${targetPostType}",
  "content_objective": "${targetObjective}",
  "content_pillar": "${targetPillar}",
  "design_reference": "توجيه بصري وإخراجي للمصمم",
  "cta": "الدعوة لاتخاذ الإجراء في الكابشن"
}`;

  return { systemPrompt, userPrompt };
}
