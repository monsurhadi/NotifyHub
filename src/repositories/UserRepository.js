'use strict';

class UserRepository {
  constructor(db) { this.db = db; }
  create(u, tx = this.db) {
    return tx.run(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, failed_attempts, locked_until, created_at) VALUES (?,?,?,?,?,0,0,?)`,
      [u.id, u.tenantId, u.email, u.passwordHash, u.role || 'admin', u.createdAt],
    );
  }
  findByEmail(email) { return this.db.get('SELECT * FROM users WHERE email = ?', [email]); }
  findById(id) { return this.db.get('SELECT * FROM users WHERE id = ?', [id]); }
  async createAuthToken(token, tx = this.db) {
    return tx.run('INSERT INTO auth_tokens (id, user_id, token_hash, purpose, expires_at, consumed_at, created_at) VALUES (?,?,?,?,?,NULL,?)',
      [token.id, token.userId, token.tokenHash, token.purpose, token.expiresAt, token.createdAt]);
  }
  revokeAuthTokens(userId, purpose, now, tx = this.db) {
    return tx.run('UPDATE auth_tokens SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL', [now, userId, purpose]);
  }
  async isEmailVerified(userId) {
    return !!(await this.db.get('SELECT id FROM auth_tokens WHERE user_id = ? AND purpose = ? AND consumed_at IS NOT NULL LIMIT 1', [userId, 'verify-email']));
  }
  async consumeAuthToken(tokenHash, purpose, now, tx = this.db) {
    const token = await tx.get('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?', [tokenHash, purpose, now]);
    if (!token) return null;
    const updated = await tx.run('UPDATE auth_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?', [now, token.id, now]);
    return updated.changes === 1 ? token : null;
  }
  updatePassword(userId, passwordHash, tx = this.db) {
    return tx.run('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?', [passwordHash, userId]);
  }
  setLoginState(id, failedAttempts, lockedUntil) {
    return this.db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [failedAttempts, lockedUntil, id]);
  }
}
module.exports = { UserRepository };
