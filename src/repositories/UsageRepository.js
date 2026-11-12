'use strict';

class UsageRepository {
  constructor(db) { this.db = db; }
  async get(tenantId, period) {
    const row = await this.db.get('SELECT used FROM usage_counters WHERE tenant_id = ? AND period = ?', [tenantId, period]);
    return row ? row.used : 0;
  }
  /** Reserves `n` notifications if the plan limit allows it. Returns the new total, or null when over the limit. */
  async reserve(tenantId, period, n, limit, tx = this.db) {
    await tx.run('INSERT INTO usage_counters (tenant_id, period, used) VALUES (?,?,0) ON CONFLICT (tenant_id, period) DO NOTHING', [tenantId, period]);
    const row = await tx.get(
      'UPDATE usage_counters SET used = used + ? WHERE tenant_id = ? AND period = ? AND used + ? <= ? RETURNING used',
      [n, tenantId, period, n, limit],
    );
    return row ? row.used : null;
  }
  addIdempotency(tenantId, key, notificationId, tx = this.db) {
    return tx.run('INSERT INTO idempotency_keys (tenant_id, idem_key, notification_id) VALUES (?,?,?)', [tenantId, key, notificationId]);
  }
  findIdempotency(tenantId, key) {
    return this.db.get('SELECT notification_id FROM idempotency_keys WHERE tenant_id = ? AND idem_key = ?', [tenantId, key]);
  }
}
module.exports = { UsageRepository };
