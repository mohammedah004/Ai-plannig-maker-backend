/**
 * Quota Policy Configuration
 * Maps user roles to daily successful marketing plan generation limits.
 */

export const QUOTA_POLICIES = {
  admin: {
    role: "admin",
    dailyLimit: null, // null represents unlimited quota
    label: "unlimited",
  },
  user: {
    role: "user",
    dailyLimit: 1, // 1 successful generation per UTC day
    label: "1/day",
  },
};

/**
 * Resolves the quota policy for a given role.
 * Falls back safely to the standard 'user' policy if role is missing or invalid.
 *
 * @param {string|null|undefined} role
 * @returns {{ role: string, dailyLimit: number|null, label: string }}
 */
export function resolveQuota(role) {
  if (!role || typeof role !== "string") {
    return QUOTA_POLICIES.user;
  }

  const normalized = role.trim().toLowerCase();
  return QUOTA_POLICIES[normalized] || QUOTA_POLICIES.user;
}

/**
 * Returns the start of current UTC day as a Date object.
 *
 * @returns {Date}
 */
export function getUTCDayStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Returns the start of the next UTC day (when daily quota resets) in ISO format.
 *
 * @returns {string} ISO timestamp
 */
export function getNextUTCDayReset() {
  const now = new Date();
  const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return nextDay.toISOString();
}
