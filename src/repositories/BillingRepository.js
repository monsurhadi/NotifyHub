'use strict';

class BillingRepository {
  constructor(db) { this.db = db; }
  createSession(s) {
    return this.db.run(
      'INSERT INTO checkout_sessions (id, tenant_id, plan, status, provider_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [s.id, s.tenantId, s.plan, 'open', s.providerRef || null, s.createdAt, s.createdAt],
    );
  }
  findSession(tenantId, id) { return this.db.get('SELECT * FROM checkout_sessions WHERE tenant_id = ? AND id = ?', [tenantId, id]); }
  /** Only moves a session out of "open" once, so a payment can never be applied twice. */
  async closeSession(tenantId, id, status, now) {
    const r = await this.db.run("UPDATE checkout_sessions SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'open'", [status, now, tenantId, id]);
    return r.changes > 0;
  }
  addEvent(e) {
    return this.db.run('INSERT INTO billing_events (id, tenant_id, type, detail, created_at) VALUES (?,?,?,?,?)', [e.id, e.tenantId, e.type, e.detail || null, e.createdAt]);
  }
  listEvents(tenantId, limit = 20) {
    return this.db.all('SELECT type, detail, created_at FROM billing_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?', [tenantId, limit]);
  }
}
module.exports = { BillingRepository };
