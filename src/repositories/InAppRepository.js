'use strict';

class InAppRepository {
  constructor(db) { this.db = db; }
  /** Idempotent: one in-app message per notification. */
  add(m) {
    return this.db.run(
      `INSERT INTO in_app_messages (id, tenant_id, user_ref, subject, body, notification_id, created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (notification_id) DO NOTHING`,
      [m.id, m.tenantId, m.userRef, m.subject || null, m.body, m.notificationId, m.createdAt],
    );
  }
  list(tenantId, userRef, limit = 50) {
    return this.db.all(
      `SELECT id, subject, body, notification_id, created_at, read_at FROM in_app_messages
       WHERE tenant_id = ? AND user_ref = ? ORDER BY created_at DESC LIMIT ?`,
      [tenantId, userRef, limit],
    );
  }
}
module.exports = { InAppRepository };
