'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

describe('tenant isolation (NFR-04)', () => {
  let ctx; let A; let B; let aTpl; let aNote; let aHook;
  before(async () => {
    ctx = await startApp();
    A = await ctx.newTenant('Alpha');
    B = await ctx.newTenant('Beta');
    aTpl = await A.template('email', { name: 'secret-template' });
    aNote = (await A.send({ channel: 'email', recipient: 'alpha-user@example.com', template_id: aTpl.id, payload: { name: 'Alpha' } })).body.id;
    aHook = (await ctx.api('POST', '/api/webhooks', { token: A.token, body: { url: 'https://alpha.example.com/hook' } })).body.id;
    await ctx.drain();
  });
  after(async () => { await ctx.stop(); });

  it('B cannot read A\'s notification and the answer is identical to "does not exist"', async () => {
    const foreign = await B.get(aNote);
    const missing = await B.get('00000000-0000-4000-8000-000000000000');
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.ok(!JSON.stringify(foreign.body).includes('alpha-user'));
    assert.equal((await A.get(aNote)).status, 200);
  });

  it('B cannot use, read, edit or archive A\'s templates', async () => {
    const use = await B.send({ channel: 'email', recipient: 'x@example.com', template_id: aTpl.id, payload: { name: 'B' } });
    assert.equal(use.status, 404);
    assert.equal((await ctx.api('GET', `/v1/templates/${aTpl.id}`, { key: B.key })).status, 404);
    assert.equal((await ctx.api('PUT', `/v1/templates/${aTpl.id}`, { key: B.key, body: { body: 'hacked {{name}}' } })).status, 404);
    assert.equal((await ctx.api('POST', `/v1/templates/${aTpl.id}/archive`, { key: B.key })).status, 404);
    assert.equal((await ctx.api('GET', `/v1/templates/${aTpl.id}/versions`, { key: B.key })).status, 404);
    const still = await ctx.api('GET', `/v1/templates/${aTpl.id}`, { key: A.key });
    assert.equal(still.body.version, 1);
    assert.equal(still.body.status, 'active');
    assert.ok(!(await ctx.api('GET', '/v1/templates', { key: B.key })).body.templates.some((t) => t.id === aTpl.id));
  });

  it('a spoofed tenant id in the body or headers is ignored: the tenant always comes from the credential', async () => {
    const bTpl = await B.template('email');
    const r = await ctx.api('POST', '/v1/notifications', {
      key: B.key, headers: { 'x-tenant-id': A.tenantId },
      body: { channel: 'email', recipient: 'spoof@example.com', template_id: bTpl.id, payload: { name: 'B' }, tenant_id: A.tenantId, tenantId: A.tenantId },
    });
    assert.equal(r.status, 202);
    assert.equal((await B.get(r.body.id)).status, 200);
    assert.equal((await A.get(r.body.id)).status, 404);
    assert.ok(!(await ctx.api('GET', '/v1/notifications', { key: A.key })).body.notifications.some((n) => n.id === r.body.id));
    await ctx.drain();
  });

  it('lists, analytics and CSV export only contain the caller\'s own records', async () => {
    const list = await ctx.api('GET', '/v1/notifications?limit=200', { key: B.key });
    assert.ok(!list.body.notifications.some((n) => n.id === aNote));
    const summary = await ctx.api('GET', '/v1/analytics/summary', { key: B.key });
    const aSummary = await ctx.api('GET', '/v1/analytics/summary', { key: A.key });
    assert.equal(aSummary.body.totals.total, 1);
    assert.equal(summary.body.totals.total, list.body.notifications.length);
    const csv = await ctx.api('GET', '/v1/analytics/export.csv', { key: B.key });
    assert.ok(!csv.body.includes(aNote));
    assert.ok(!csv.body.includes('a***@example.com'));
  });

  it('injection strings are treated as plain text', async () => {
    const q = encodeURIComponent("' OR 1=1 --");
    const list = await ctx.api('GET', `/v1/notifications?status=${q}`, { key: B.key });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.notifications, []);
    assert.equal((await ctx.api('GET', `/v1/analytics/summary?status=${q}`, { key: B.key })).status, 400);
    assert.equal((await ctx.api('GET', `/v1/analytics/summary?channel=${q}`, { key: B.key })).status, 400);
    const noSuchInbox = await ctx.api('GET', `/v1/inbox/${q}`, { key: B.key });
    assert.deepEqual(noSuchInbox.body.messages, []);
    const tenants = await ctx.container.db.get('SELECT COUNT(*) AS n FROM tenants');
    assert.ok(tenants.n >= 2, 'tables are intact');
  });

  it('B cannot see or remove A\'s webhook settings or secret, and cannot read A\'s in-app inbox', async () => {
    const mine = await ctx.api('GET', '/api/webhooks', { token: B.token });
    const theirs = await ctx.api('GET', '/api/webhooks', { token: A.token });
    assert.equal(mine.body.endpoints.length, 0);
    assert.notEqual(mine.body.signingSecret, theirs.body.signingSecret);
    assert.equal((await ctx.api('DELETE', `/api/webhooks/${aHook}`, { token: B.token })).status, 404);
    assert.equal((await ctx.api('GET', '/api/webhooks', { token: A.token })).body.endpoints.length, 1);
    const inApp = await A.template('in-app');
    await A.send({ channel: 'in-app', recipient: 'shared-user', template_id: inApp.id, payload: { name: 'A' } });
    await ctx.drain();
    assert.equal((await ctx.api('GET', '/v1/inbox/shared-user', { key: A.key })).body.messages.length, 1);
    assert.equal((await ctx.api('GET', '/v1/inbox/shared-user', { key: B.key })).body.messages.length, 0);
    assert.equal((await ctx.api('DELETE', `/api/keys/${(await ctx.api('GET', '/api/keys', { token: A.token })).body.keys[0].id}`, { token: B.token })).status, 404);
  });
});
