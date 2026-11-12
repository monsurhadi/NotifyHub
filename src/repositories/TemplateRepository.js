'use strict';

const SELECT_CURRENT = `
  SELECT t.id, t.tenant_id, t.name, t.channel, t.status, t.current_version, t.created_at, t.updated_at,
         v.subject, v.body, v.placeholders
  FROM templates t
  JOIN template_versions v ON v.template_id = t.id AND v.version = t.current_version`;

class TemplateRepository {
  constructor(db) { this.db = db; }

  insertTemplate(t, tx = this.db) {
    return tx.run(
      `INSERT INTO templates (id, tenant_id, name, channel, status, current_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [t.id, t.tenantId, t.name, t.channel, 'active', 1, t.createdAt, t.createdAt],
    );
  }
  insertVersion(v, tx = this.db) {
    return tx.run(
      `INSERT INTO template_versions (id, template_id, tenant_id, version, subject, body, placeholders, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [v.id, v.templateId, v.tenantId, v.version, v.subject, v.body, JSON.stringify(v.placeholders), v.createdAt],
    );
  }
  findById(tenantId, id, db = this.db) { return db.get(`${SELECT_CURRENT} WHERE t.tenant_id = ? AND t.id = ?`, [tenantId, id]); }
  findByName(tenantId, name) { return this.db.get('SELECT id FROM templates WHERE tenant_id = ? AND name = ?', [tenantId, name]); }
  list(tenantId, { includeArchived = false } = {}) {
    return this.db.all(
      `${SELECT_CURRENT} WHERE t.tenant_id = ? ${includeArchived ? '' : "AND t.status = 'active'"} ORDER BY t.created_at DESC`,
      [tenantId],
    );
  }
  versions(tenantId, templateId) {
    return this.db.all(
      'SELECT version, subject, body, placeholders, created_at FROM template_versions WHERE tenant_id = ? AND template_id = ? ORDER BY version DESC',
      [tenantId, templateId],
    );
  }
  /** Atomically reserves the next version number (safe for simultaneous edits). */
  bumpVersion(tenantId, id, now, tx = this.db) {
    return tx.get(
      `UPDATE templates SET current_version = current_version + 1, updated_at = ?
       WHERE tenant_id = ? AND id = ? AND status = 'active' RETURNING current_version`,
      [now, tenantId, id],
    );
  }
  async archive(tenantId, id, now) {
    const r = await this.db.run("UPDATE templates SET status = 'archived', updated_at = ? WHERE tenant_id = ? AND id = ?", [now, tenantId, id]);
    return r.changes > 0;
  }
}
module.exports = { TemplateRepository };
