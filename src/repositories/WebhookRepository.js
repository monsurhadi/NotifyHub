'use strict';

class WebhookRepository {
  constructor(db) { this.db = db; }
  createEndpoint(e) {
    return this.db.run('INSERT INTO webhook_endpoints (id, tenant_id, url, active, created_at) VALUES (?,?,?,1,?)', [e.id, e.tenantId, e.url, e.createdAt]);
  }
  listEndpoints(tenantId) {
    return this.db.all('SELECT id, url, active, created_at FROM webhook_endpoints WHERE tenant_id = ? AND active = 1 ORDER BY created_at', [tenantId]);
  }
  findEndpoint(tenantId, id) { return this.db.get('SELECT * FROM webhook_endpoints WHERE tenant_id = ? AND id = ?', [tenantId, id]); }
  async deactivate(tenantId, id) {
    const r = await this.db.run('UPDATE webhook_endpoints SET active = 0 WHERE tenant_id = ? AND id = ? AND active = 1', [tenantId, id]);
    return r.changes > 0;
  }
  addAttempt(a) {
    return this.db.run(
      `INSERT INTO webhook_attempts (id, tenant_id, endpoint_id, event_id, notification_id, attempt_number, http_status, error, success, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [a.id, a.tenantId, a.endpointId, a.eventId, a.notificationId || null, a.attemptNumber, a.httpStatus ?? null, a.error || null, a.success ? 1 : 0, a.createdAt],
    );
  }
  listAttempts(tenantId, limit = 50) {
    return this.db.all(
      `SELECT a.id, a.endpoint_id, e.url, a.event_id, a.notification_id, a.attempt_number, a.http_status, a.error, a.success, a.created_at
       FROM webhook_attempts a LEFT JOIN webhook_endpoints e ON e.id = a.endpoint_id
       WHERE a.tenant_id = ? ORDER BY a.created_at DESC, a.attempt_number DESC LIMIT ?`,
      [tenantId, limit],
    );
  }
}
module.exports = { WebhookRepository };
