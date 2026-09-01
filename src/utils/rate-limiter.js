/**
 * In-Memory Sliding Window Rate Limiter
 * Tracks requests per identifier within a rolling time window.
 */
const rateLimitStore = new Map();

// Periodic cleanup of expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitStore.entries()) {
    const validTimestamps = timestamps.filter((t) => now - t < 3600000);
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, validTimestamps);
    }
  }
}, 10 * 60 * 1000).unref();

/**
 * Checks and records rate limit for a specific user/key.
 *
 * @param {string} key - Unique identifier (e.g. userId)
 * @param {number} maxRequests - Max requests allowed in window (default 10)
 * @param {number} windowMs - Window duration in milliseconds (default 1 hour = 3600000ms)
 * @returns {{ allowed: boolean, remaining: number, resetMinutes: number }}
 */
export function checkRateLimit(key, maxRequests = 10, windowMs = 3600000) {
  const now = Date.now();
  const timestamps = rateLimitStore.get(key) || [];

  // Filter timestamps within current sliding window
  const windowStart = now - windowMs;
  const recentTimestamps = timestamps.filter((t) => t > windowStart);

  if (recentTimestamps.length >= maxRequests) {
    const oldestInWindow = recentTimestamps[0];
    const resetTimeMs = oldestInWindow + windowMs - now;
    const resetMinutes = Math.max(1, Math.ceil(resetTimeMs / (60 * 1000)));

    return {
      allowed: false,
      remaining: 0,
      resetMinutes,
    };
  }

  // Record this request
  recentTimestamps.push(now);
  rateLimitStore.set(key, recentTimestamps);

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - recentTimestamps.length),
    resetMinutes: Math.ceil(windowMs / (60 * 1000)),
  };
}

/**
 * Helper to clear rate limits (used in test teardown)
 */
export function resetRateLimits() {
  rateLimitStore.clear();
}
