'use strict';

class DeliveryAttemptRepository {
  constructor(db) { this.db = db; }
  add(a) {
    return this.db.run(
      `INSERT INTO delivery_attempts (id, notification_id, tenant_id, attempt_number, status, error, provider_message_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [a.id, a.notificationId, a.tenantId, a.attemptNumber, a.status, a.error || null, a.providerMessageId || null, a.createdAt],
    );
  }
  list(tenantId, notificationId) {
    return this.db.all(
      `SELECT attempt_number, status, error, provider_message_id, created_at FROM delivery_attempts
       WHERE tenant_id = ? AND notification_id = ? ORDER BY attempt_number, created_at`,
      [tenantId, notificationId],
    );
  }
}
module.exports = { DeliveryAttemptRepository };
