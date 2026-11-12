'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, sleep } = require('./helpers');

describe('registration, login and API keys (FR-01, FR-02, FR-03)', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.stop(); });

  it('registers a workspace, rejects duplicates and bad input, and sends a confirmation email', async () => {
    const ok = await ctx.api('POST', '/api/register', { body: { companyName: 'Acme Ltd', email: 'Admin@Acme.test', password: 'secret-pass' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.tenant.email, 'admin@acme.test');
    assert.equal(ok.body.tenant.plan, 'free');
    assert.equal(ok.body.tenant.verificationToken?.length, 64);
    const pendingLogin = await ctx.api('POST', '/api/auth/login', { body: { email: 'admin@acme.test', password: 'secret-pass' } });
    assert.equal(pendingLogin.status, 403);
    assert.equal(pendingLogin.body.error.code, 'email_not_verified');
    const resend = await ctx.api('POST', '/api/auth/verification', { body: { email: 'admin@acme.test' } });
    assert.equal(resend.status, 200);
    assert.equal(resend.body.message, 'If this account still needs verification, a new link has been sent.');
    assert.equal((await ctx.api('POST', '/api/auth/verify-email', { body: { token: ok.body.tenant.verificationToken } })).status, 400, 'resending revokes the older token');
    assert.equal((await ctx.api('POST', '/api/auth/verify-email', { body: { token: resend.body.verificationToken } })).status, 200);
    assert.equal((await ctx.api('POST', '/api/auth/verify-email', { body: { token: resend.body.verificationToken } })).status, 400, 'verification tokens are one-use');

    const dupEmail = await ctx.api('POST', '/api/register', { body: { companyName: 'Other Name', email: 'admin@acme.test', password: 'secret-pass' } });
    assert.equal(dupEmail.status, 409);
    const dupName = await ctx.api('POST', '/api/register', { body: { companyName: '  acme   LTD ', email: 'someone@else.test', password: 'secret-pass' } });
    assert.equal(dupName.status, 409);
    assert.equal(dupName.body.error.code, 'duplicate_tenant');

    assert.equal((await ctx.api('POST', '/api/register', { body: { companyName: 'X', email: 'a@b.test', password: 'secret-pass' } })).status, 400);
    assert.equal((await ctx.api('POST', '/api/register', { body: { companyName: 'Good Name', email: 'not-an-email', password: 'secret-pass' } })).status, 400);
    assert.equal((await ctx.api('POST', '/api/register', { body: { companyName: 'Good Name', email: 'g@b.test', password: 'short' } })).status, 400);

    const login = await ctx.api('POST', '/api/auth/login', { body: { email: 'admin@acme.test', password: 'secret-pass' } });
    assert.equal(login.status, 200);
    const mail = await waitFor(async () => (await ctx.api('GET', '/api/dev/outbox', { token: login.body.token })).body.messages.find((m) => /Welcome/.test(m.subject)));
    assert.equal(mail.recipient, 'admin@acme.test');
    assert.ok(mail.body.includes('verified'));
  });

  it('sends private, expiring password-reset links and consumes each token once', async () => {
    const t = await ctx.newTenant('Reset');
    const unknown = await ctx.api('POST', '/api/auth/password-reset', { body: { email: 'missing@example.test' } });
    const known = await ctx.api('POST', '/api/auth/password-reset', { body: { email: t.email } });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.equal(known.body.message, unknown.body.message, 'response does not reveal whether the account exists');
    assert.equal(known.body.resetToken?.length, 64);

    const expired = await ctx.container.db.get('SELECT id FROM auth_tokens WHERE user_id = ? AND purpose = ?', [
      (await ctx.container.repos.users.findByEmail(t.email)).id, 'reset-password',
    ]);
    await ctx.container.db.run('UPDATE auth_tokens SET expires_at = ? WHERE id = ?', [Date.now() - 1, expired.id]);
    assert.equal((await ctx.api('POST', '/api/auth/password-reset/complete', { body: { token: known.body.resetToken, password: 'replacement-pass' } })).status, 400);

    const fresh = await ctx.api('POST', '/api/auth/password-reset', { body: { email: t.email } });
    assert.equal((await ctx.api('POST', '/api/auth/password-reset/complete', { body: { token: fresh.body.resetToken, password: 'replacement-pass' } })).status, 200);
    assert.equal((await ctx.api('POST', '/api/auth/password-reset/complete', { body: { token: fresh.body.resetToken, password: 'another-pass' } })).status, 400);
    assert.equal((await ctx.api('POST', '/api/auth/login', { body: { email: t.email, password: 'password123' } })).status, 401);
    assert.equal((await ctx.api('POST', '/api/auth/login', { body: { email: t.email, password: 'replacement-pass' } })).status, 200);
  });

  it('logs in, rejects wrong passwords, locks the account after 3 failures and unlocks later', async () => {
    const t = await ctx.newTenant('Lock');
    const bad = () => ctx.api('POST', '/api/auth/login', { body: { email: t.email, password: 'wrong-password' } });
    assert.equal((await bad()).status, 401);
    assert.equal((await bad()).status, 401);
    assert.equal((await bad()).status, 401);
    const locked = await ctx.api('POST', '/api/auth/login', { body: { email: t.email, password: 'password123' } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'account_locked');
    await sleep(1100);
    const again = await ctx.api('POST', '/api/auth/login', { body: { email: t.email, password: 'password123' } });
    assert.equal(again.status, 200);
    assert.ok(again.body.token);
    assert.equal(again.body.expiresIn, 3600);
  });

  it('protects endpoints and expires/rejects bad tokens', async () => {
    assert.equal((await ctx.api('GET', '/api/me')).status, 401);
    assert.equal((await ctx.api('GET', '/api/me', { token: 'garbage.token.here' })).status, 401);
    const t = await ctx.newTenant('Me');
    const me = await ctx.api('GET', '/api/me', { token: t.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.tenant.email, t.email);
    assert.equal((await ctx.api('GET', '/v1/templates')).status, 401);
  });

  it('creates API keys that are shown once, stored hashed, work for /v1, and stop working when revoked', async () => {
    const t = await ctx.newTenant('Keys');
    const created = await ctx.api('POST', '/api/keys', { token: t.token, body: { name: 'ci' } });
    assert.equal(created.status, 201);
    assert.match(created.body.key, /^nh_[a-f0-9]{12}_[a-f0-9]{48}$/);

    const list = await ctx.api('GET', '/api/keys', { token: t.token });
    assert.ok(list.body.keys.length >= 2);
    assert.ok(!JSON.stringify(list.body).includes(created.body.key.split('_')[2]), 'secret must never be listed again');

    const secret = created.body.key.split('_')[2];
    const row = await ctx.container.db.get('SELECT * FROM api_keys WHERE id = ?', [created.body.id]);
    assert.notEqual(row.secret_hash, secret);
    assert.ok(!JSON.stringify(row).includes(secret));

    assert.equal((await ctx.api('GET', '/v1/templates', { key: created.body.key })).status, 200);
    assert.equal((await ctx.api('GET', '/api/keys', { key: created.body.key })).status, 403, 'admin endpoints need a login token');

    assert.equal((await ctx.api('DELETE', `/api/keys/${created.body.id}`, { token: t.token })).status, 200);
    const after = await ctx.api('GET', '/v1/templates', { key: created.body.key });
    assert.equal(after.status, 401);
    assert.equal((await ctx.api('GET', '/v1/templates', { key: `nh_${'0'.repeat(12)}_${'0'.repeat(48)}` })).status, 401);
  });

  it('exposes a health check and an operator overview protected by a token', async () => {
    const h = await ctx.api('GET', '/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.status, 'ok');
    assert.equal((await ctx.api('GET', '/api/platform/overview')).status, 401);
    await ctx.worker._heartbeat();
    const o = await ctx.api('GET', '/api/platform/overview', { headers: { 'x-admin-token': 'dev-admin-token' } });
    assert.equal(o.status, 200);
    assert.ok(o.body.tenants >= 1);
    assert.ok(o.body.workersAlive >= 1);
    assert.ok('queued' in o.body.queue);
  });
});
