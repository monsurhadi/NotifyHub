'use strict';

/** What the simulated e-mail/SMS provider "sent" (also used for local demos and tests). */
class OutboxRepository {
  constructor(db) { this.db = db; }
  /** Returns true when a new row was written, false when this idempotency key was already delivered. */
  async insertOnce(m) {
    const r = await this.db.run(
      `INSERT INTO outbox (id, idem_key, tenant_id, channel, recipient, subject, body, created_at) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (idem_key) DO NOTHING`,
      [m.id, m.idemKey, m.tenantId, m.channel, m.recipient, m.subject || null, m.body, m.createdAt],
    );
    return r.changes > 0;
  }
  list(tenantId, limit = 50) {
    return this.db.all('SELECT channel, recipient, subject, body, idem_key, created_at FROM outbox WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?', [tenantId, limit]);
  }
}
module.exports = { OutboxRepository };
