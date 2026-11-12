'use strict';
const { BUCKETS } = require('../domain/constants');

const dayStart = (d) => `${d}T00:00:00.000Z`;
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00.000Z`) + 86400000).toISOString();

/** Builds the shared WHERE clause for analytics / export queries (always tenant-scoped). */
function filterClause(tenantId, { from, to, channel, statuses }) {
  const where = ['tenant_id = ?', 'created_at >= ?', 'created_at < ?'];
  const params = [tenantId, dayStart(from), nextDay(to)];
  if (channel) { where.push('channel = ?'); params.push(channel); }
  if (statuses && statuses.length) { where.push(`status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
  return { sql: where.join(' AND '), params };
}

class NotificationRepository {
  constructor(db) { this.db = db; }

  create(n, tx = this.db) {
    return tx.run(
      `INSERT INTO notifications (id, tenant_id, template_id, template_version, channel, recipient, payload, subject, body, status, attempts, last_error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)`,
      [n.id, n.tenantId, n.templateId, n.templateVersion, n.channel, n.recipient, JSON.stringify(n.payload), n.subject, n.body, n.status, n.createdAt, n.createdAt],
    );
  }

  /** Tenant-scoped read (what the API uses). */
  findById(tenantId, id) { return this.db.get('SELECT * FROM notifications WHERE tenant_id = ? AND id = ?', [tenantId, id]); }
  /** System read used by the worker, which only has a job payload. */
  findByIdSystem(id) { return this.db.get('SELECT * FROM notifications WHERE id = ?', [id]); }

  /** System write used by the worker. `attempts` is left untouched when null. */
  updateState(id, { status, attempts = null, lastError = null }, now) {
    return this.db.run(
      'UPDATE notifications SET status = ?, attempts = COALESCE(?, attempts), last_error = ?, updated_at = ? WHERE id = ?',
      [status, attempts, lastError, now, id],
    );
  }

  list(tenantId, { status, channel, limit = 50, offset = 0 } = {}) {
    const where = ['tenant_id = ?'];
    const params = [tenantId];
    if (status) { where.push('status = ?'); params.push(status); }
    if (channel) { where.push('channel = ?'); params.push(channel); }
    params.push(limit, offset);
    return this.db.all(
      `SELECT id, channel, recipient, status, attempts, template_id, template_version, last_error, created_at, updated_at
       FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      params,
    );
  }

  aggregate(tenantId, filter) {
    const { sql, params } = filterClause(tenantId, filter);
    return this.db.all(`SELECT channel, status, COUNT(*) AS n FROM notifications WHERE ${sql} GROUP BY channel, status`, params);
  }
  byDay(tenantId, filter) {
    const { sql, params } = filterClause(tenantId, filter);
    return this.db.all(
      `SELECT SUBSTR(created_at, 1, 10) AS day, status, COUNT(*) AS n FROM notifications WHERE ${sql}
       GROUP BY SUBSTR(created_at, 1, 10), status ORDER BY day`,
      params,
    );
  }
  exportRows(tenantId, filter) {
    const { sql, params } = filterClause(tenantId, filter);
    return this.db.all(
      `SELECT id, channel, recipient, status, attempts, created_at, updated_at FROM notifications WHERE ${sql} ORDER BY created_at, id`,
      params,
    );
  }
  async countByStatus() {
    return this.db.all('SELECT status, COUNT(*) AS n FROM notifications GROUP BY status');
  }
}
module.exports = { NotificationRepository, BUCKETS };
