'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, startReceiver } = require('./helpers');

const sign = (secret, raw) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

describe('webhook status events (FR-11, FR-12)', () => {
  let ctx;
  before(async () => { ctx = await startApp({ webhookTimeoutMs: 300 }); });
  after(async () => { await ctx.stop(); });

  async function sendOne(t, recipient = 'wh@example.com') {
    const tpl = await t.template('email');
    return (await t.send({ channel: 'email', recipient, template_id: tpl.id, payload: { name: 'A' } })).body.id;
  }

  it('registers valid URLs only, lists them and can remove them', async () => {
    const t = await ctx.newTenant('Hook');
    assert.equal((await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: 'htp:/x' } })).status, 400);
    assert.equal((await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: 'not a url' } })).status, 400);
    assert.equal((await ctx.api('POST', '/api/webhooks', { token: t.token, body: {} })).status, 400);
    const ok = await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: 'https://client.example.com/hook' } });
    assert.equal(ok.status, 201);
    const list = await ctx.api('GET', '/api/webhooks', { token: t.token });
    assert.equal(list.body.endpoints.length, 1);
    assert.match(list.body.signingSecret, /^whsec_/);
    assert.equal((await ctx.api('DELETE', `/api/webhooks/${ok.body.id}`, { token: t.token })).status, 200);
    assert.equal((await ctx.api('GET', '/api/webhooks', { token: t.token })).body.endpoints.length, 0);
  });

  it('sends one signed POST per status change; a tampered body fails verification', async () => {
    const t = await ctx.newTenant('Signed');
    const receiver = await startReceiver();
    try {
      await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: receiver.url } });
      const id = await sendOne(t);
      await ctx.drain();
      const secret = (await ctx.api('GET', '/api/webhooks', { token: t.token })).body.signingSecret;
      assert.deepEqual(receiver.requests.map((q) => q.json.data.status), ['queued', 'delivered']);
      for (const q of receiver.requests) {
        assert.equal(q.json.type, 'notification.status_changed');
        assert.equal(q.json.data.notification_id, id);
        assert.ok(q.json.created_at);
        assert.equal(q.headers['x-notifyhub-signature'], sign(secret, q.raw));
        assert.notEqual(q.headers['x-notifyhub-signature'], sign(secret, q.raw.replace(/"status":"\w+"/, '"status":"failed-by-attacker"')), 'a tampered body must not verify');
      }
    } finally { await receiver.close(); }
  });

  it('retries a failing endpoint up to 3 times (4 attempts) and then gives up; attempts are visible', async () => {
    const t = await ctx.newTenant('Retry');
    const receiver = await startReceiver(() => ({ status: 500 }));
    try {
      await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: receiver.url } });
      await sendOne(t);
      await ctx.drain();
      const attempts = (await ctx.api('GET', '/api/webhooks/attempts', { token: t.token })).body.attempts;
      const byEvent = new Map();
      for (const a of attempts) byEvent.set(a.eventId, [...(byEvent.get(a.eventId) || []), a]);
      assert.equal(byEvent.size, 2, 'queued + delivered events');
      for (const list of byEvent.values()) {
        assert.equal(list.length, 4);
        assert.deepEqual(list.map((a) => a.attempt).sort(), [1, 2, 3, 4]);
        assert.ok(list.every((a) => a.httpStatus === 500 && a.success === false && a.error === 'HTTP 500' && a.at));
      }
    } finally { await receiver.close(); }
  });

  it('stops retrying after the first success', async () => {
    const t = await ctx.newTenant('Recover');
    const seen = new Map();
    const receiver = await startReceiver((req) => {
      const evt = req.json.id;
      seen.set(evt, (seen.get(evt) || 0) + 1);
      return { status: seen.get(evt) < 2 ? 503 : 200 };
    });
    try {
      await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: receiver.url } });
      await sendOne(t);
      await ctx.drain();
      assert.ok([...seen.values()].every((n) => n === 2));
      const attempts = (await ctx.api('GET', '/api/webhooks/attempts', { token: t.token })).body.attempts;
      assert.equal(attempts.filter((a) => a.success).length, 2);
    } finally { await receiver.close(); }
  });

  it('a hanging endpoint counts as a timeout and never blocks notification delivery', async () => {
    const t = await ctx.newTenant('Hang');
    const receiver = await startReceiver(() => ({ hang: true }));
    try {
      await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: receiver.url } });
      const id = await sendOne(t);
      await ctx.drain(20000);
      assert.equal((await t.get(id)).body.status, 'delivered');
      const attempts = (await ctx.api('GET', '/api/webhooks/attempts', { token: t.token })).body.attempts;
      assert.ok(attempts.length >= 2);
      assert.ok(attempts.every((a) => a.error === 'Timeout' && !a.success));
    } finally { await receiver.close(); }
  });

  it('provider delivery receipts update the status; wrong secret is refused; status API matches', async () => {
    const t = await ctx.newTenant('Receipt');
    const id = await sendOne(t);
    await ctx.drain();
    const url = `/internal/provider-callbacks/${id}`;
    assert.equal((await ctx.api('POST', url, { body: { status: 'failed' } })).status, 401);
    assert.equal((await ctx.api('POST', url, { body: { status: 'failed' }, headers: { 'x-callback-secret': 'wrong' } })).status, 401);
    const bad = await ctx.api('POST', url, { body: { status: 'weird' }, headers: { 'x-callback-secret': 'dev-callback-secret' } });
    assert.equal(bad.status, 400);
    const ok = await ctx.api('POST', url, { body: { status: 'failed' }, headers: { 'x-callback-secret': 'dev-callback-secret' } });
    assert.equal(ok.status, 200);
    assert.equal((await t.get(id)).body.status, 'failed');
    assert.equal((await ctx.api('POST', '/internal/provider-callbacks/nope', { body: { status: 'failed' }, headers: { 'x-callback-secret': 'dev-callback-secret' } })).status, 404);
  });

  it('a removed endpoint receives nothing more', async () => {
    const t = await ctx.newTenant('Removed');
    const receiver = await startReceiver();
    try {
      const ep = await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: receiver.url } });
      await ctx.api('DELETE', `/api/webhooks/${ep.body.id}`, { token: t.token });
      await sendOne(t);
      await ctx.drain();
      assert.equal(receiver.requests.length, 0);
    } finally { await receiver.close(); }
  });
});
