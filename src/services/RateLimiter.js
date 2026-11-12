'use strict';

/**
 * Fixed-window limiter per tenant + channel (FR-10).
 * The configured limit is cached for a few seconds only, so a changed limit takes effect
 * within seconds (requirement: within 60 s) and without restarting anything.
 */
class RateLimiter {
  constructor(repo, config) { this.repo = repo; this.config = config; this.cache = new Map(); this.lastPurge = 0; }

  clearCache(tenantId, channel) { this.cache.delete(`${tenantId}:${channel}`); }

  async limitFor(tenantId, channel) {
    const key = `${tenantId}:${channel}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.config.rateConfigCacheMs) return hit.value;
    const stored = await this.repo.get(tenantId, channel);
    const value = stored ?? this.config.defaultRatePerMinute;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async tryConsume(tenantId, channel, now = Date.now()) {
    const win = this.config.rateWindowMs;
    const windowStart = Math.floor(now / win) * win;
    const limit = await this.limitFor(tenantId, channel);
    const hits = await this.repo.hit(tenantId, channel, windowStart);
    if (hits <= limit) {
      if (now - this.lastPurge > win * 10) { this.lastPurge = now; this.repo.purgeOlderThan(windowStart - win * 5).catch(() => {}); }
      return { allowed: true, retryAfterMs: 0 };
    }
    await this.repo.undoHit(tenantId, channel, windowStart); // the excess request must not use up the window
    return { allowed: false, retryAfterMs: windowStart + win - now + 5 };
  }
}
module.exports = { RateLimiter };
