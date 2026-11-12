'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

describe('bulk sending and the 1000 recipient limit (FR-07)', () => {
  let ctx;
  before(async () => { ctx = await startApp({ plans: { free: { name: 'Free', monthlyLimit: 5000 } } }); });
  after(async () => { await ctx.stop(); });

  const emails = (n) => Array.from({ length: n }, (_, i) => `user${i}@example.com`);

  it('enforces the boundaries 0, 1, 2, 999, 1000, 1001', async () => {
    const t = await ctx.newTenant('Bulk');
    const tpl = await t.template('email');
    const bulk = (recipients) => ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'Friend' }, recipients } });

    assert.equal((await bulk([])).status, 400);
    const one = await bulk(emails(1));
    assert.equal(one.status, 202);
    assert.equal(one.body.accepted, 1);
    const two = await bulk(emails(2));
    assert.equal(two.body.accepted, 2);
    assert.notEqual(two.body.results[0].notificationId, two.body.results[1].notificationId);
    assert.equal((await bulk(emails(999))).body.accepted, 999);
    const max = await bulk(emails(1000));
    assert.equal(max.status, 202);
    assert.equal(max.body.accepted, 1000);
    assert.equal(new Set(max.body.results.map((r) => r.notificationId)).size, 1000);
    const over = await bulk(emails(1001));
    assert.equal(over.status, 413);
    assert.equal(over.body.error.code, 'batch_too_large');
    assert.equal((await ctx.api('GET', '/v1/usage', { key: t.key })).body.used, 1 + 2 + 999 + 1000, 'rejected batches use no quota');
  });

  it('one invalid recipient does not block the rest, and per-recipient payloads work', async () => {
    const t = await ctx.newTenant('Mixed');
    const tpl = await t.template('email');
    const recipients = emails(20);
    recipients[10] = 'not-an-email';
    recipients[11] = { recipient: 'custom@example.com', payload: { name: 'Custom' } };
    const r = await ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'Friend' }, recipients } });
    assert.equal(r.status, 202);
    assert.equal(r.body.accepted, 19);
    assert.equal(r.body.rejected, 1);
    assert.equal(r.body.results[10].status, 'rejected');
    assert.equal(r.body.results[10].error.code, 'invalid_recipient');
    assert.equal(r.body.results[0].status, 'queued');
    const custom = await t.get(r.body.results[11].notificationId);
    assert.equal(custom.body.subject, 'Hello Custom');
    const none = await ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'F' }, recipients: ['bad', 'worse'] } });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.code, 'batch_rejected');
  });

  it('every accepted recipient is delivered as its own tracked notification', async () => {
    const t = await ctx.newTenant('Deliver');
    const tpl = await t.template('email');
    const r = await ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'F' }, recipients: emails(30) } });
    assert.equal(r.body.accepted, 30);
    await ctx.drain(30000);
    const list = await ctx.api('GET', '/v1/notifications?limit=200', { key: t.key });
    assert.equal(list.body.notifications.length, 30);
    assert.ok(list.body.notifications.every((n) => n.status === 'delivered'));
    assert.ok(list.body.notifications.every((n) => n.recipient.includes('***')), 'list masks recipients');
  });
});
