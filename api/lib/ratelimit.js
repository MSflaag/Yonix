// api/lib/ratelimit.js — In-memory rate limiter for Vercel Serverless
// Note: each serverless instance has its own memory.
// For production, upgrade to @upstash/ratelimit with Redis.

const stores = new Map();

/**
 * Create a rate limiter
 * @param {string} name - Unique name for this limiter
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Window size in milliseconds
 */
export function createRateLimit(name, maxRequests = 5, windowMs = 60000) {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name);

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, windowMs * 2).unref?.();

  return function check(identifier) {
    const now = Date.now();
    const key = String(identifier);

    if (!store.has(key)) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    const entry = store.get(key);
    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
      return { allowed: true, remaining: maxRequests - 1 };
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }

    return { allowed: true, remaining: maxRequests - entry.count };
  };
}

/**
 * Extract client IP from Vercel request
 */
export function getClientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
