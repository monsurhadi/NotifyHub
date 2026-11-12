'use strict';

class RateLimitRepository {
  constructor(db) { this.db = db; }
  async get(tenantId, channel) {
    const r = await this.db.get('SELECT per_minute FROM rate_limits WHERE tenant_id = ? AND channel = ?', [tenantId, channel]);
    return r ? r.per_minute : null;
  }
  list(tenantId) { return this.db.all('SELECT channel, per_minute FROM rate_limits WHERE tenant_id = ? ORDER BY channel', [tenantId]); }
  set(tenantId, channel, perMinute) {
    return this.db.run(
      `INSERT INTO rate_limits (tenant_id, channel, per_minute) VALUES (?,?,?)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET per_minute = excluded.per_minute`,
      [tenantId, channel, perMinute],
    );
  }
  /** Atomic counter for the current window. Returns the number of hits including this one. */
  async hit(tenantId, channel, windowStart) {
    const row = await this.db.get(
      `INSERT INTO rate_counters (tenant_id, channel, window_start, hits) VALUES (?,?,?,1)
       ON CONFLICT (tenant_id, channel, window_start) DO UPDATE SET hits = rate_counters.hits + 1 RETURNING hits`,
      [tenantId, channel, windowStart],
    );
    return row.hits;
  }
  undoHit(tenantId, channel, windowStart) {
    return this.db.run('UPDATE rate_counters SET hits = hits - 1 WHERE tenant_id = ? AND channel = ? AND window_start = ? AND hits > 0', [tenantId, channel, windowStart]);
  }
  purgeOlderThan(windowStart) { return this.db.run('DELETE FROM rate_counters WHERE window_start < ?', [windowStart]); }
}
module.exports = { RateLimitRepository };
