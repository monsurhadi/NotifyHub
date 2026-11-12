'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

describe('plan limits, usage and upgrade (FR-15, FR-16)', () => {
  let ctx;
  before(async () => { ctx = await startApp({ plans: { free: { name: 'Free', monthlyLimit: 3 } } }); });
  after(async () => { await ctx.stop(); });

  const send = (t, tplId, to) => t.send({ channel: 'email', recipient: to, template_id: tplId, payload: { name: 'A' } });
  const billing = (t) => ctx.api('GET', '/api/billing', { token: t.token });

  it('counts only successfully queued notifications and returns 429 at the limit', async () => {
    const t = await ctx.newTenant('Plan');
    const tpl = await t.template('email');
    assert.deepEqual([(await billing(t)).body.plan, (await billing(t)).body.limit, (await billing(t)).body.used], ['free', 3, 0]);
    assert.equal((await send(t, tpl.id, 'one@example.com')).status, 202);
    assert.equal((await billing(t)).body.used, 1);
    assert.equal((await t.send({ channel: 'email', recipient: 'bad', template_id: tpl.id, payload: { name: 'A' } })).status, 400);
    assert.equal((await t.send({ channel: 'email', recipient: 'x@example.com', template_id: tpl.id, payload: {} })).status, 422);
    assert.equal((await billing(t)).body.used, 1, 'failed validation does not count');
    assert.equal((await send(t, tpl.id, 'two@example.com')).status, 202);
    assert.equal((await send(t, tpl.id, 'three@example.com')).status, 202);
    const blocked = await send(t, tpl.id, 'four@example.com');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'plan_limit_reached');
    const o = (await billing(t)).body;
    assert.equal(o.used, 3);
    assert.equal(o.remaining, 0);
    assert.equal((await ctx.api('GET', '/v1/notifications', { key: t.key })).body.notifications.length, 3, 'the blocked one was not queued');
    assert.equal((await ctx.api('GET', '/v1/usage', { key: t.key })).body.used, 3, 'API-key users can read usage too');
    await ctx.drain();
  });

  it('a bulk request is accepted up to the remaining quota and the rest is reported as rejected', async () => {
    const t = await ctx.newTenant('PartBulk');
    const tpl = await t.template('email');
    const r = await ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'A' }, recipients: ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test'] } });
    assert.equal(r.status, 202);
    assert.equal(r.body.accepted, 3);
    assert.equal(r.body.rejected, 2);
    assert.equal(r.body.results[4].error.code, 'plan_limit_reached');
    const again = await ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'A' }, recipients: ['z@x.test'] } });
    assert.equal(again.status, 429);
    await ctx.drain();
  });

  it('upgrade flow: declined card, unknown card and cancel change nothing; the success card upgrades immediately', async () => {
    const t = await ctx.newTenant('Upgrade');
    const tpl = await t.template('email');
    for (const to of ['u1@x.test', 'u2@x.test', 'u3@x.test']) await send(t, tpl.id, to);
    assert.equal((await send(t, tpl.id, 'u4@x.test')).status, 429);

    const co = await ctx.api('POST', '/api/billing/checkout', { token: t.token });
    assert.equal(co.status, 201);
    assert.equal(co.body.mode, 'mock');
    const pay = (card) => ctx.api('POST', `/api/billing/checkout/${co.body.sessionId}/pay`, { token: t.token, body: { cardNumber: card } });

    const declined = await pay('4000 0000 0000 0002');
    assert.equal(declined.status, 402);
    assert.equal(declined.body.error.code, 'card_declined');
    assert.equal((await pay('1234 5678 9012 3456')).status, 402);
    let o = (await billing(t)).body;
    assert.equal(o.plan, 'free');
    assert.equal(o.limit, 3);
    assert.ok(o.events.some((e) => e.type === 'payment_failed'));
    assert.ok(!o.events.some((e) => e.type === 'payment_succeeded'));

    const cancelled = await ctx.api('POST', `/api/billing/checkout/${co.body.sessionId}/cancel`, { token: t.token });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.plan, 'free');
    assert.equal((await pay('4242 4242 4242 4242')).status, 409, 'a cancelled checkout cannot be paid');

    const co2 = await ctx.api('POST', '/api/billing/checkout', { token: t.token });
    const ok = await ctx.api('POST', `/api/billing/checkout/${co2.body.sessionId}/pay`, { token: t.token, body: { cardNumber: '4242 4242 4242 4242' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.plan, 'pro');
    assert.equal(ok.body.limit, 50000);
    assert.equal(ok.body.used, 3, 'usage is kept');
    assert.ok(ok.body.events.some((e) => e.type === 'payment_succeeded'));
    assert.equal((await send(t, tpl.id, 'u5@x.test')).status, 202, 'sending works right after the upgrade');

    const twice = await ctx.api('POST', `/api/billing/checkout/${co2.body.sessionId}/pay`, { token: t.token, body: { cardNumber: '4242 4242 4242 4242' } });
    assert.equal(twice.status, 409, 'a paid checkout cannot be paid again');
    const again = await ctx.api('POST', '/api/billing/checkout', { token: t.token });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'already_pro');
    const succeeded = (await billing(t)).body.events.filter((e) => e.type === 'payment_succeeded');
    assert.equal(succeeded.length, 1, 'exactly one charge');
    await ctx.drain();
  });

  it('checkout belongs to one tenant and billing needs a login token', async () => {
    const a = await ctx.newTenant('PayA');
    const b = await ctx.newTenant('PayB');
    const co = await ctx.api('POST', '/api/billing/checkout', { token: a.token });
    const steal = await ctx.api('POST', `/api/billing/checkout/${co.body.sessionId}/pay`, { token: b.token, body: { cardNumber: '4242 4242 4242 4242' } });
    assert.equal(steal.status, 404);
    assert.equal((await billing(b)).body.plan, 'free');
    assert.equal((await ctx.api('POST', '/api/billing/checkout', { key: a.key })).status, 403);
  });
});
