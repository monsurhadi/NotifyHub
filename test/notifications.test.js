'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, startReceiver } = require('./helpers');

describe('single notification, channel routing and idempotency (FR-06, FR-08, FR-11)', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.stop(); });

  it('queues a valid request (202) and the worker delivers it', async () => {
    const t = await ctx.newTenant('Single');
    const tpl = await t.template('email');
    const started = Date.now();
    const r = await t.send({ channel: 'email', recipient: 'user@example.com', template_id: tpl.id, payload: { name: 'Asha' } });
    assert.equal(r.status, 202);
    assert.ok(Date.now() - started < 200, 'accepting a request must be fast');
    assert.equal(r.body.status, 'queued');
    assert.ok(r.body.id);
    assert.equal((await t.get(r.body.id)).body.status, 'queued');

    await ctx.drain();
    const done = await t.get(r.body.id);
    assert.equal(done.body.status, 'delivered');
    assert.equal(done.body.attempts, 1);
    assert.equal(done.body.deliveryAttempts.length, 1);
    assert.equal(done.body.deliveryAttempts[0].status, 'success');
    const outbox = await ctx.api('GET', '/api/dev/outbox', { token: t.token });
    const mail = outbox.body.messages.find((m) => m.recipient === 'user@example.com');
    assert.equal(mail.subject, 'Hello Asha');
    assert.equal(mail.body, '<p>Hi Asha</p>');
  });

  it('rejects malformed requests with 400/404 and queues nothing', async () => {
    const t = await ctx.newTenant('Syntax');
    const tpl = await t.template('email');
    const good = { channel: 'email', recipient: 'user@example.com', template_id: tpl.id, payload: { name: 'Asha' } };
    const cases = [
      ['missing channel', { ...good, channel: undefined }, 400, /channel/],
      ['recipient with two @', { ...good, recipient: 'user@@example' }, 400, /recipient/],
      ['empty recipient', { ...good, recipient: '' }, 400, /recipient/],
      ['unknown template id', { ...good, template_id: 'abc' }, 404, /Template/],
      ['payload is a string', { ...good, payload: 'name=Asha' }, 400, /payload/],
      ['missing template_id', { ...good, template_id: undefined }, 400, /template_id/],
    ];
    for (const [label, body, status, pattern] of cases) {
      const r = await t.send(body);
      assert.equal(r.status, status, label);
      assert.match(r.body.error.message, pattern, label);
    }
    const malformed = await ctx.api('POST', '/v1/notifications', { key: t.key, body: '{"channel": "email",' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'malformed_json');
    assert.equal((await ctx.api('GET', '/v1/notifications', { key: t.key })).body.notifications.length, 0);
  });

  it('escapes HTML in payload values for email and in-app, but not for SMS', async () => {
    const t = await ctx.newTenant('Escape');
    const email = await t.template('email');
    const sms = await t.template('sms');
    const evil = '<script>alert("x")</script>';
    const a = await t.send({ channel: 'email', recipient: 'xss@example.com', template_id: email.id, payload: { name: evil } });
    const b = await t.send({ channel: 'sms', recipient: '+8801712345678', template_id: sms.id, payload: { name: evil } });
    assert.ok((await t.get(a.body.id)).body.body.includes('&lt;script&gt;'));
    assert.ok(!(await t.get(a.body.id)).body.body.includes('<script>'));
    assert.equal((await t.get(b.body.id)).body.body, `Hi ${evil}`);
  });

  it('routes each channel to its own adapter and rejects bad channel/template/recipient combinations', async () => {
    const t = await ctx.newTenant('Route');
    const receiver = await startReceiver();
    try {
      const tpl = { email: await t.template('email'), sms: await t.template('sms'), webhook: await t.template('webhook'), inapp: await t.template('in-app') };
      const ids = {};
      for (const [channel, recipient, template] of [
        ['email', 'route@example.com', tpl.email], ['sms', '+8801712345678', tpl.sms],
        ['webhook', receiver.url, tpl.webhook], ['in-app', 'user-102', tpl.inapp],
      ]) {
        const r = await t.send({ channel, recipient, template_id: template.id, payload: { name: 'Asha' } });
        assert.equal(r.status, 202, channel);
        ids[channel] = r.body.id;
      }
      await ctx.drain();
      for (const id of Object.values(ids)) assert.equal((await t.get(id)).body.status, 'delivered');

      const outbox = (await ctx.api('GET', '/api/dev/outbox', { token: t.token })).body.messages;
      assert.ok(outbox.some((m) => m.channel === 'email' && m.recipient === 'route@example.com'));
      assert.ok(outbox.some((m) => m.channel === 'sms' && m.recipient === '+8801712345678'));
      assert.equal(receiver.requests.length, 1);
      const secret = (await ctx.api('GET', '/api/webhooks', { token: t.token })).body.signingSecret;
      const sig = `sha256=${crypto.createHmac('sha256', secret).update(receiver.requests[0].raw).digest('hex')}`;
      assert.equal(receiver.requests[0].headers['x-notifyhub-signature'], sig);
      assert.equal(receiver.requests[0].json.body, 'Hi Asha');
      const inbox = await ctx.api('GET', '/v1/inbox/user-102', { key: t.key });
      assert.equal(inbox.body.messages.length, 1);
      assert.equal(inbox.body.messages[0].body, 'Hi Asha');

      const mismatch = await t.send({ channel: 'email', recipient: 'a@b.test', template_id: tpl.sms.id, payload: { name: 'A' } });
      assert.equal(mismatch.status, 422);
      assert.equal(mismatch.body.error.code, 'template_channel_mismatch');
      const badPhone = await t.send({ channel: 'sms', recipient: 'not-a-number', template_id: tpl.sms.id, payload: { name: 'A' } });
      assert.equal(badPhone.status, 400);
      const fax = await t.send({ channel: 'fax', recipient: '12345', template_id: tpl.sms.id, payload: { name: 'A' } });
      assert.equal(fax.status, 400);
      assert.equal(fax.body.error.code, 'unsupported_channel');
    } finally { await receiver.close(); }
  });

  it('honours Idempotency-Key: the same key creates one notification and counts once', async () => {
    const t = await ctx.newTenant('Idem');
    const tpl = await t.template('email');
    const body = { channel: 'email', recipient: 'idem@example.com', template_id: tpl.id, payload: { name: 'A' } };
    const first = await t.send(body, { 'idempotency-key': 'order-42' });
    const second = await t.send(body, { 'idempotency-key': 'order-42' });
    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    assert.equal((await ctx.api('GET', '/v1/usage', { key: t.key })).body.used, 1);
    const [x, y] = await Promise.all([t.send(body, { 'idempotency-key': 'race-1' }), t.send(body, { 'idempotency-key': 'race-1' })]);
    assert.equal(x.body.id, y.body.id);
    assert.equal((await ctx.api('GET', '/v1/usage', { key: t.key })).body.used, 2);
    await ctx.drain();
  });
});
