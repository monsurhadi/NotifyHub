'use strict';
const { newId, randomHex, hashPassword, verifyPassword, signJwt, verifyJwt, sha256, safeEqual } = require('../util/crypto');
const { badRequest, conflict, unauthorized, forbidden, tooMany } = require('../domain/errors');
const { isUniqueViolation } = require('../db/createDatabase');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let dummyHash = null;

/** Registration, login (with lockout), JWT sessions and API-key authentication. */
class AuthService {
  constructor({ config, db, tenants, users, apiKeys, mailer, logger }) {
    Object.assign(this, { config, db, tenants, users, apiKeys, mailer, logger });
  }

  async register(input) {
    const body = input && typeof input === 'object' ? input : {};
    const name = typeof body.companyName === 'string' ? body.companyName.trim().replace(/\s+/g, ' ') : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2 || name.length > 100) throw badRequest('companyName must be between 2 and 100 characters', { field: 'companyName' });
    if (!EMAIL.test(email) || email.length > 254) throw badRequest('email is not a valid email address', { field: 'email' });
    if (password.length < 8 || password.length > 200) throw badRequest('password must be at least 8 characters', { field: 'password' });

    const nameKey = name.toLowerCase();
    const duplicate = (await this.tenants.findByNameKey(nameKey)) || (await this.tenants.findByEmail(email)) || (await this.users.findByEmail(email));
    if (duplicate) throw conflict('A workspace with this company name or email already exists', 'duplicate_tenant');

    const tenant = { id: newId(), name, nameKey, email, webhookSecret: `whsec_${randomHex(24)}`, createdAt: new Date().toISOString() };
    const userId = newId();
    const passwordHash = await hashPassword(password);
    const verification = this._newAuthToken(userId, 'verify-email', this.config.emailVerificationTtlMs);
    try {
      await this.db.transaction(async (tx) => {
        await this.tenants.create(tenant, tx);
        await this.users.create({ id: userId, tenantId: tenant.id, email, passwordHash, role: 'admin', createdAt: tenant.createdAt }, tx);
        await this.users.createAuthToken(verification.record, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A workspace with this company name or email already exists', 'duplicate_tenant');
      throw err;
    }
    const url = this._authUrl('verify', verification.token);
    this.mailer.sendVerification({ tenant, url, notificationId: verification.record.id }).catch((err) => this.logger.error('verification email failed', { tenantId: tenant.id, err: err.message }));
    return { id: tenant.id, name, email, plan: 'free', createdAt: tenant.createdAt,
      ...(this.config.env === 'development' ? { verificationToken: verification.token } : {}) };
  }

  _newAuthToken(userId, purpose, ttlMs) {
    const token = randomHex(32);
    const now = Date.now();
    return { token, record: { id: newId(), userId, tokenHash: sha256(token), purpose, expiresAt: now + ttlMs, createdAt: now } };
  }

  _authUrl(kind, token) {
    const base = String(this.config.publicBaseUrl || '').replace(/\/$/, '');
    return `${base}/?${kind}=${encodeURIComponent(token)}`;
  }

  async verifyEmail(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw badRequest('Verification link is invalid or expired', {}, 'invalid_auth_token');
    const consumed = await this.users.consumeAuthToken(sha256(token), 'verify-email', Date.now());
    if (!consumed) throw badRequest('Verification link is invalid or expired', {}, 'invalid_auth_token');
    const tenant = await this.tenants.findById(consumed.user_id ? (await this.users.findById(consumed.user_id)).tenant_id : null);
    if (tenant) this.mailer.sendWelcome(tenant).catch((err) => this.logger.error('welcome email failed', { tenantId: tenant.id, err: err.message }));
    return { verified: true };
  }

  async requestEmailVerification(input) {
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const response = { message: 'If this account still needs verification, a new link has been sent.' };
    if (!EMAIL.test(email) || email.length > 254) return response;
    const user = await this.users.findByEmail(email);
    if (!user || await this.users.isEmailVerified(user.id)) return response;
    const verification = this._newAuthToken(user.id, 'verify-email', this.config.emailVerificationTtlMs);
    await this.db.transaction(async (tx) => {
      await this.users.revokeAuthTokens(user.id, 'verify-email', Date.now(), tx);
      await this.users.createAuthToken(verification.record, tx);
    });
    const tenant = await this.tenants.findById(user.tenant_id);
    this.mailer.sendVerification({ tenant, url: this._authUrl('verify', verification.token), notificationId: verification.record.id })
      .catch((err) => this.logger.error('verification resend failed', { tenantId: user.tenant_id, err: err.message }));
    return this.config.env === 'development' ? { ...response, verificationToken: verification.token } : response;
  }

  async requestPasswordReset(input) {
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const response = { message: 'If an account matches that address, a password reset link has been sent.' };
    if (!EMAIL.test(email) || email.length > 254) return response;
    const user = await this.users.findByEmail(email);
    if (!user) return response;
    const reset = this._newAuthToken(user.id, 'reset-password', this.config.passwordResetTtlMs);
    await this.db.transaction(async (tx) => {
      await this.users.revokeAuthTokens(user.id, 'reset-password', Date.now(), tx);
      await this.users.createAuthToken(reset.record, tx);
    });
    const tenant = await this.tenants.findById(user.tenant_id);
    this.mailer.sendPasswordReset({ tenantId: user.tenant_id, email: user.email, name: tenant?.name || '', url: this._authUrl('reset', reset.token), notificationId: reset.record.id })
      .catch((err) => this.logger.error('password reset email failed', { userId: user.id, err: err.message }));
    return this.config.env === 'development' ? { ...response, resetToken: reset.token } : response;
  }

  async completePasswordReset(input) {
    const body = input && typeof input === 'object' ? input : {};
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8 || password.length > 200) throw badRequest('password must be between 8 and 200 characters', { field: 'password' });
    if (!/^[a-f0-9]{64}$/.test(token)) throw badRequest('Reset link is invalid or expired', {}, 'invalid_auth_token');
    const passwordHash = await hashPassword(password);
    const consumed = await this.db.transaction(async (tx) => {
      const row = await this.users.consumeAuthToken(sha256(token), 'reset-password', Date.now(), tx);
      if (!row) return null;
      await this.users.updatePassword(row.user_id, passwordHash, tx);
      return row;
    });
    if (!consumed) throw badRequest('Reset link is invalid or expired', {}, 'invalid_auth_token');
    return { passwordReset: true, message: 'Password updated. Sign in with your new password.' };
  }

  async login(input) {
    const body = input && typeof input === 'object' ? input : {};
    if (typeof body.email !== 'string' || typeof body.password !== 'string') throw badRequest('email and password are required');
    const user = await this.users.findByEmail(body.email.trim().toLowerCase());
    const now = Date.now();
    if (user && user.locked_until > now) {
      const retryAfterSeconds = Math.ceil((user.locked_until - now) / 1000);
      throw tooMany(`Too many failed login attempts. Try again in ${retryAfterSeconds} seconds.`, 'account_locked', { retryAfterSeconds });
    }
    if (!dummyHash) dummyHash = await hashPassword('timing-equaliser');
    const ok = user ? await verifyPassword(body.password, user.password_hash) : (await verifyPassword(body.password, dummyHash), false);
    if (!ok) {
      if (user) {
        const failed = user.failed_attempts + 1;
        if (failed >= this.config.loginMaxAttempts) await this.users.setLoginState(user.id, 0, now + this.config.loginLockSeconds * 1000);
        else await this.users.setLoginState(user.id, failed, 0);
      }
      throw unauthorized('Invalid email or password', 'invalid_credentials');
    }
    if (!(await this.users.isEmailVerified(user.id))) throw forbidden('Verify your email before signing in. Request a new verification link if it has expired.', 'email_not_verified');
    if (user.failed_attempts || user.locked_until) await this.users.setLoginState(user.id, 0, 0);
    const tenant = await this.tenants.findById(user.tenant_id);
    if (!tenant || tenant.status !== 'active') throw forbidden('This workspace is suspended', 'tenant_suspended');
    const token = signJwt({ sub: user.id, tid: tenant.id, role: user.role }, this.config.jwtSecret, this.config.jwtTtlSeconds);
    return { token, expiresIn: this.config.jwtTtlSeconds, tenant: { id: tenant.id, name: tenant.name, email: tenant.email, plan: tenant.plan } };
  }

  async _activeTenant(tenantId) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw unauthorized('Unknown workspace', 'invalid_token');
    if (tenant.status !== 'active') throw forbidden('This workspace is suspended', 'tenant_suspended');
    return tenant;
  }

  async authenticateJwt(token) {
    const claims = verifyJwt(token, this.config.jwtSecret);
    if (!claims) throw unauthorized('Invalid or expired token', 'invalid_token');
    await this._activeTenant(claims.tid);
    return { type: 'jwt', tenantId: claims.tid, userId: claims.sub, role: claims.role };
  }

  async authenticateApiKey(raw) {
    const m = /^nh_([a-f0-9]{12})_([a-f0-9]{48})$/.exec(String(raw));
    if (!m) throw unauthorized('Invalid API key', 'invalid_api_key');
    const row = await this.apiKeys.findByKeyId(m[1]);
    if (!row || row.revoked_at || !safeEqual(sha256(row.salt + m[2]), row.secret_hash)) throw unauthorized('Invalid or revoked API key', 'invalid_api_key');
    await this._activeTenant(row.tenant_id);
    if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60000) this.apiKeys.touch(row.id, new Date().toISOString()).catch(() => {});
    return { type: 'apikey', tenantId: row.tenant_id, apiKeyId: row.id };
  }

  async me(tenantId, userId) {
    const tenant = await this.tenants.findById(tenantId);
    const user = userId ? await this.users.findById(userId) : null;
    return { tenant: { id: tenant.id, name: tenant.name, email: tenant.email, plan: tenant.plan, createdAt: tenant.created_at }, user: user ? { id: user.id, email: user.email, role: user.role } : null };
  }
}
module.exports = { AuthService };
