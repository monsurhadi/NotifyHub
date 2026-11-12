'use strict';
const { newId, randomHex, sha256 } = require('../util/crypto');
const { badRequest, notFound } = require('../domain/errors');

/** FR-03: keys look like nh_<keyId>_<secret>. The secret is shown once and only a salted hash is stored. */
class ApiKeyService {
  constructor({ apiKeys }) { this.apiKeys = apiKeys; }

  async create(tenantId, name) {
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Default key';
    if (typeof name !== 'undefined' && typeof name !== 'string') throw badRequest('name must be a string', { field: 'name' });
    const keyId = randomHex(6);
    const secret = randomHex(24);
    const salt = randomHex(16);
    const row = { id: newId(), tenantId, keyId, secretHash: sha256(salt + secret), salt, name: label, createdAt: new Date().toISOString() };
    await this.apiKeys.create(row);
    return { id: row.id, name: label, key: `nh_${keyId}_${secret}`, prefix: `nh_${keyId}`, createdAt: row.createdAt, note: 'Copy this key now. It will not be shown again.' };
  }

  async list(tenantId) {
    return (await this.apiKeys.list(tenantId)).map((k) => ({ id: k.id, name: k.name, prefix: `nh_${k.key_id}`, createdAt: k.created_at, revokedAt: k.revoked_at, lastUsedAt: k.last_used_at }));
  }

  async revoke(tenantId, id) {
    const owned = await this.apiKeys.findOwned(tenantId, id);
    if (!owned) throw notFound('API key not found', 'api_key_not_found');
    await this.apiKeys.revoke(tenantId, id, new Date().toISOString());
    return { id, revoked: true };
  }
}
module.exports = { ApiKeyService };
