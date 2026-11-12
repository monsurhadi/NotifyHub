'use strict';

class TenantRepository {
  constructor(db) { this.db = db; }
  create(t, tx = this.db) {
    return tx.run(
      `INSERT INTO tenants (id, name, name_key, email, status, plan, webhook_secret, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [t.id, t.name, t.nameKey, t.email, 'active', 'free', t.webhookSecret, t.createdAt],
    );
  }
  findById(id, db = this.db) { return db.get('SELECT * FROM tenants WHERE id = ?', [id]); }
  findByEmail(email) { return this.db.get('SELECT * FROM tenants WHERE email = ?', [email]); }
  findByNameKey(key) { return this.db.get('SELECT * FROM tenants WHERE name_key = ?', [key]); }
  setPlan(id, plan, tx = this.db) { return tx.run('UPDATE tenants SET plan = ? WHERE id = ?', [plan, id]); }
  async count() { return (await this.db.get('SELECT COUNT(*) AS n FROM tenants')).n; }
}
module.exports = { TenantRepository };
