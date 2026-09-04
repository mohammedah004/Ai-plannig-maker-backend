/**
 * Strategic Impact Engine (Blockers B08, B09)
 *
 * 100% Deterministic JavaScript - 0 AI Quota, 0 Latency.
 * Calculates the exact delta between current plan metrics and proposed changes.
 * Supports single-day or multi-day Change Sets.
 */

export const STRATEGIC_FIELDS = ["post_type", "content_objective", "content_pillar"];

/**
 * Metadata for Objectives
 */
export const OBJECTIVE_LABELS = {
  awareness: "توعية وجذب (Awareness)",
  education: "تعليم وقيمة (Education)",
  engagement: "تفاعل ومجتمع (Engagement)",
  trust: "بناء ثقة ومصداقية (Trust)",
  social_proof: "إثبات اجتماعي (Social Proof)",
  objection_handling: "تفنيد الاعتراضات (Objection Handling)",
  conversion: "تحويل ومبيعات مباشرة (Conversion)",
};

/**
 * Metadata for Formats
 */
export const FORMAT_LABELS = {
  reel: "ريلز (Reels)",
  carousel: "كاروسيل (Carousels)",
  static_post: "منشورات ثابتة (Static Posts)",
  story: "ستوري (Stories)",
};

/**
 * Clones and applies a Change Set to an array of 30 content items.
 *
 * @param {Array<Object>} allItems - Full 30-day items
 * @param {Array<{ day_number: number, changes: Object }>} changeSet
 * @returns {Array<Object>}
 */
export function simulatePlanWithChangeSet(allItems = [], changeSet = []) {
  const changeMap = new Map();
  changeSet.forEach((item) => {
    changeMap.set(item.day_number, item.changes);
  });

  return allItems.map((item) => {
    const changes = changeMap.get(item.day_number);
    if (!changes) {
      return { ...item };
    }

    const mergedDesignCopy =
      changes.design_copy || item.design_copy
        ? {
            headline: changes.design_copy?.headline ?? item.design_copy?.headline ?? "",
            subtext: changes.design_copy?.subtext ?? item.design_copy?.subtext ?? "",
            cta: changes.design_copy?.cta ?? item.design_copy?.cta ?? "",
          }
        : item.design_copy;

    return {
      ...item,
      ...changes,
      design_copy: mergedDesignCopy,
    };
  });
}

/**
 * Computes percentage breakdown for a given key.
 *
 * @param {Array<Object>} items
 * @param {string} fieldKey
 * @returns {Record<string, { count: number, percentage: number }>}
 */
function computeDistribution(items = [], fieldKey) {
  const total = items.length || 1;
  const counts = {};

  items.forEach((item) => {
    const rawVal = item[fieldKey];
    if (rawVal) {
      const key = String(rawVal).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
  });

  const distribution = {};
  Object.entries(counts).forEach(([k, count]) => {
    distribution[k] = {
      count,
      percentage: Math.round((count / total) * 100),
    };
  });

  return distribution;
}

/**
 * Calculates strategic deltas between current items and proposed Change Set.
 *
 * @param {Object} params
 * @param {Array<Object>} params.allItems - All 30 items
 * @param {Array<{ day_number: number, changes: Object }>} params.changeSet - 1 or more modified items
 * @returns {Object} Strategic impact summary
 */
export function calculateStrategicImpactForChangeSet({ allItems = [], changeSet = [] }) {
  if (!allItems || allItems.length === 0 || !changeSet || changeSet.length === 0) {
    return {
      hasStrategicImpact: false,
      objectiveShift: null,
      formatShift: null,
      pillarShift: null,
      summaryArabic: "لا توجد تعديلات استراتيجية.",
    };
  }

  // 1. Check if any strategic field is being mutated
  let hasStrategicChange = false;
  for (const item of changeSet) {
    const keys = Object.keys(item.changes || {});
    if (keys.some((k) => STRATEGIC_FIELDS.includes(k))) {
      hasStrategicChange = true;
      break;
    }
  }

  if (!hasStrategicChange) {
    return {
      hasStrategicImpact: false,
      objectiveShift: null,
      formatShift: null,
      pillarShift: null,
      summaryArabic: "التعديل يقتصر على الصياغة البصرية والنصية دون التأثير على توازن الخطة الاستراتيجي.",
    };
  }

  // 2. Simulate simulated 30-day state
  const simulatedItems = simulatePlanWithChangeSet(allItems, changeSet);

  // 3. Compute current vs simulated distributions
  const currentObjectives = computeDistribution(allItems, "content_objective");
  const simulatedObjectives = computeDistribution(simulatedItems, "content_objective");

  const currentFormats = computeDistribution(allItems, "post_type");
  const simulatedFormats = computeDistribution(simulatedItems, "post_type");

  const currentPillars = computeDistribution(allItems, "content_pillar");
  const simulatedPillars = computeDistribution(simulatedItems, "content_pillar");

  // 4. Calculate deltas
  const objectiveDeltas = [];
  const allObjKeys = new Set([...Object.keys(currentObjectives), ...Object.keys(simulatedObjectives)]);
  allObjKeys.forEach((key) => {
    const before = currentObjectives[key] || { count: 0, percentage: 0 };
    const after = simulatedObjectives[key] || { count: 0, percentage: 0 };
    if (before.percentage !== after.percentage || before.count !== after.count) {
      objectiveDeltas.push({
        key,
        label: OBJECTIVE_LABELS[key] || key,
        oldCount: before.count,
        newCount: after.count,
        oldPercentage: before.percentage,
        newPercentage: after.percentage,
        deltaPercentage: after.percentage - before.percentage,
      });
    }
  });

  const formatDeltas = [];
  const allFormatKeys = new Set([...Object.keys(currentFormats), ...Object.keys(simulatedFormats)]);
  allFormatKeys.forEach((key) => {
    const before = currentFormats[key] || { count: 0, percentage: 0 };
    const after = simulatedFormats[key] || { count: 0, percentage: 0 };
    if (before.percentage !== after.percentage || before.count !== after.count) {
      formatDeltas.push({
        key,
        label: FORMAT_LABELS[key] || key,
        oldCount: before.count,
        newCount: after.count,
        oldPercentage: before.percentage,
        newPercentage: after.percentage,
        deltaPercentage: after.percentage - before.percentage,
      });
    }
  });

  const pillarDeltas = [];
  const allPillarKeys = new Set([...Object.keys(currentPillars), ...Object.keys(simulatedPillars)]);
  allPillarKeys.forEach((key) => {
    const before = currentPillars[key] || { count: 0, percentage: 0 };
    const after = simulatedPillars[key] || { count: 0, percentage: 0 };
    if (before.count !== after.count) {
      pillarDeltas.push({
        key,
        label: key,
        oldCount: before.count,
        newCount: after.count,
        oldPercentage: before.percentage,
        newPercentage: after.percentage,
        deltaCount: after.count - before.count,
      });
    }
  });

  // 5. Generate concise Arabic summary sentence
  const summaryParts = [];
  if (objectiveDeltas.length > 0) {
    const objText = objectiveDeltas
      .map((d) => `${d.label} (${d.oldPercentage}% ← ${d.newPercentage}%)`)
      .join("، ");
    summaryParts.push(`تغيير في توزيع الأهداف: ${objText}`);
  }
  if (formatDeltas.length > 0) {
    const fmtText = formatDeltas
      .map((d) => `${d.label} (${d.oldPercentage}% ← ${d.newPercentage}%)`)
      .join("، ");
    summaryParts.push(`تغيير في قوالب المحتوى: ${fmtText}`);
  }
  if (pillarDeltas.length > 0) {
    const pilText = pillarDeltas
      .map((d) => `${d.label} (${d.oldCount} ← ${d.newCount})`)
      .join("، ");
    summaryParts.push(`تغيير في ركائز المحتوى: ${pilText}`);
  }

  const summaryArabic = summaryParts.length > 0 ? summaryParts.join(" | ") : "لا توجد تعديلات استراتيجية جوهرية.";

  return {
    hasStrategicImpact: objectiveDeltas.length > 0 || formatDeltas.length > 0 || pillarDeltas.length > 0,
    objectiveShift: objectiveDeltas,
    formatShift: formatDeltas,
    pillarShift: pillarDeltas,
    summaryArabic,
  };
}
