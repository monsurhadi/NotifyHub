'use strict';

class ApiKeyRepository {
  constructor(db) { this.db = db; }
  create(k) {
    return this.db.run(
      `INSERT INTO api_keys (id, tenant_id, key_id, secret_hash, salt, name, created_at) VALUES (?,?,?,?,?,?,?)`,
      [k.id, k.tenantId, k.keyId, k.secretHash, k.salt, k.name, k.createdAt],
    );
  }
  /** The only lookup that is not tenant-scoped: it is how a request proves which tenant it belongs to. */
  findByKeyId(keyId) { return this.db.get('SELECT * FROM api_keys WHERE key_id = ?', [keyId]); }
  list(tenantId) {
    return this.db.all(
      'SELECT id, key_id, name, created_at, revoked_at, last_used_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC',
      [tenantId],
    );
  }
  async revoke(tenantId, id, revokedAt) {
    const r = await this.db.run('UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND id = ? AND revoked_at IS NULL', [revokedAt, tenantId, id]);
    return r.changes > 0;
  }
  findOwned(tenantId, id) { return this.db.get('SELECT id, revoked_at FROM api_keys WHERE tenant_id = ? AND id = ?', [tenantId, id]); }
  touch(id, at) { return this.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [at, id]); }
}
module.exports = { ApiKeyRepository };
