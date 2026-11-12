'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, startReceiver, sleep } = require('./helpers');
const { RetryDecorator } = require('../src/decorators/RetryDecorator');
const { RetryableDeliveryError, PermanentDeliveryError } = require('../src/domain/errors');

const WINDOW = 1500;

describe('retry with exponential backoff (FR-09)', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.stop(); });

  it('backoff doubles each time and becomes permanent after the last attempt', async () => {
    const failing = { name: 'x', send: async () => { throw new Error('boom'); } };
    const retry = new RetryDecorator(failing, { maxAttempts: 5, baseMs: 100, maxMs: 10000 });
    const delays = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assert.rejects(retry.send({ attempt }), (e) => { assert.ok(e instanceof RetryableDeliveryError); delays.push(e.delayMs); return true; });
    }
    assert.deepEqual(delays, [100, 200, 400, 800]);
    await assert.rejects(retry.send({ attempt: 5 }), PermanentDeliveryError);
  });

  it('a flaky provider fails twice, then the third attempt delivers; every attempt is logged', async () => {
    const t = await ctx.newTenant('Flaky');
    const tpl = await t.template('email');
    const r = await t.send({ channel: 'email', recipient: 'flaky@example.com', template_id: tpl.id, payload: { name: 'A' } });
    await ctx.drain();
    const n = (await t.get(r.body.id)).body;
    assert.equal(n.status, 'delivered');
    assert.equal(n.attempts, 3);
    assert.deepEqual(n.deliveryAttempts.map((a) => a.status), ['failed', 'failed', 'success']);
    assert.match(n.deliveryAttempts[0].error, /Simulated transient provider failure/);
    assert.ok(n.deliveryAttempts.every((a) => a.at));
  });

  it('a permanently failing provider ends as Failed after 5 attempts and the tenant is told by webhook', async () => {
    const t = await ctx.newTenant('Fail');
    const receiver = await startReceiver();
    try {
      await ctx.api('POST', '/api/webhooks', { token: t.token, body: { url: receiver.url } });
      const tpl = await t.template('email');
      const r = await t.send({ channel: 'email', recipient: 'fail@example.com', template_id: tpl.id, payload: { name: 'A' } });
      await ctx.drain();
      const n = (await t.get(r.body.id)).body;
      assert.equal(n.status, 'failed');
      assert.equal(n.attempts, 5);
      assert.equal(n.deliveryAttempts.filter((a) => a.status === 'failed').length, 5);
      assert.match(n.lastError, /Simulated provider failure/);

      const statuses = receiver.requests.map((q) => q.json.data.status);
      assert.equal(statuses[0], 'queued');
      assert.equal(statuses.filter((s) => s === 'retrying').length, 4);
      assert.equal(statuses[statuses.length - 1], 'failed');
    } finally { await receiver.close(); }
  });

  it('never re-sends a notification that is already Sent/Delivered/Failed (invalid transitions)', async () => {
    const t = await ctx.newTenant('Twice');
    const tpl = await t.template('email');
    const ok = await t.send({ channel: 'email', recipient: 'once@example.com', template_id: tpl.id, payload: { name: 'A' } });
    const bad = await t.send({ channel: 'email', recipient: 'fail@example.com', template_id: tpl.id, payload: { name: 'A' } });
    await ctx.drain();
    for (const id of [ok.body.id, bad.body.id]) {
      const before = (await t.get(id)).body;
      assert.deepEqual(await ctx.container.services.delivery.processDelivery({ notificationId: id }), { done: true });
      const after = (await t.get(id)).body;
      assert.equal(after.status, before.status);
      assert.equal(after.attempts, before.attempts);
    }
    await ctx.container.queue.enqueue('deliver', { notificationId: ok.body.id });
    await ctx.drain();
    const sent = (await ctx.api('GET', '/api/dev/outbox', { token: t.token })).body.messages.filter((m) => m.recipient === 'once@example.com');
    assert.equal(sent.length, 1, 'duplicate job must not produce a second message');
  });

  it('a provider that answers without a message id is treated as a failed attempt, not as success', async () => {
    const t = await ctx.newTenant('Empty');
    const tpl = await t.template('email');
    const r = await t.send({ channel: 'email', recipient: 'empty@example.com', template_id: tpl.id, payload: { name: 'A' } });
    await ctx.drain();
    const n = (await t.get(r.body.id)).body;
    assert.equal(n.status, 'failed');
    assert.match(n.lastError, /no message id/);
  });
});

describe('per-tenant, per-channel rate limiting (FR-10)', () => {
  let ctx;
  before(async () => { ctx = await startApp({ rateWindowMs: WINDOW }); });
  after(async () => { await ctx.stop(); });

  const passOnce = async () => { for (let job = await ctx.container.queue.claim('t'); job; job = await ctx.container.queue.claim('t')) await ctx.worker.runJob(job); };
  const startOfWindow = async () => { await sleep(WINDOW - (Date.now() % WINDOW) + 10); };

  it('excess requests are held (not dropped), other tenants and channels are unaffected, and held ones go out in the next window', async () => {
    const a = await ctx.newTenant('LimA');
    const b = await ctx.newTenant('LimB');
    const emailA = await a.template('email');
    const smsA = await a.template('sms');
    const emailB = await b.template('email');
    assert.equal((await ctx.api('PUT', '/api/rate-limits', { token: a.token, body: { channel: 'email', perMinute: 2 } })).status, 200);
    assert.equal((await ctx.api('PUT', '/api/rate-limits', { token: a.token, body: { channel: 'email', perMinute: 0 } })).status, 400);

    await startOfWindow();
    const sent = [];
    for (let i = 0; i < 3; i += 1) sent.push((await a.send({ channel: 'email', recipient: `a${i}@example.com`, template_id: emailA.id, payload: { name: 'A' } })).body.id);
    const bId = (await b.send({ channel: 'email', recipient: 'b@example.com', template_id: emailB.id, payload: { name: 'B' } })).body.id;
    const smsId = (await a.send({ channel: 'sms', recipient: '+8801712345678', template_id: smsA.id, payload: { name: 'A' } })).body.id;

    await passOnce();
    const statuses = await Promise.all(sent.map(async (id) => (await a.get(id)).body.status));
    assert.equal(statuses.filter((s) => s === 'delivered').length, 2, 'only 2 emails fit in the window');
    assert.equal(statuses.filter((s) => s === 'queued').length, 1, 'the third is held, not dropped, not failed');
    assert.equal((await b.get(bId)).body.status, 'delivered', 'other tenant unaffected');
    assert.equal((await a.get(smsId)).body.status, 'delivered', 'limits are per channel');
    assert.equal((await ctx.container.queue.stats()).queued, 1);

    await ctx.drain();
    for (const id of sent) assert.equal((await a.get(id)).body.status, 'delivered');
    assert.equal((await a.get(sent[0])).body.attempts, 1, 'a deferral is not a delivery attempt');
  });

  it('a changed limit applies without restarting anything', async () => {
    const t = await ctx.newTenant('LimC');
    const tpl = await t.template('email');
    await ctx.api('PUT', '/api/rate-limits', { token: t.token, body: { channel: 'email', perMinute: 1 } });
    await startOfWindow();
    const ids = [];
    for (let i = 0; i < 3; i += 1) ids.push((await t.send({ channel: 'email', recipient: `c${i}@example.com`, template_id: tpl.id, payload: { name: 'C' } })).body.id);
    await ctx.api('PUT', '/api/rate-limits', { token: t.token, body: { channel: 'email', perMinute: 10 } });
    await passOnce();
    for (const id of ids) assert.equal((await t.get(id)).body.status, 'delivered');
    const limits = await ctx.api('GET', '/api/rate-limits', { token: t.token });
    assert.equal(limits.body.limits.find((l) => l.channel === 'email').perMinute, 10);
    await ctx.drain();
  });
});

describe('crash recovery and duplicate protection (NFR-05)', () => {
  let ctx;
  before(async () => { ctx = await startApp({ jobLockTimeoutMs: 100 }); });
  after(async () => { await ctx.stop(); });

  it('a job whose worker died is picked up by another worker and delivered exactly once', async () => {
    const t = await ctx.newTenant('Crash');
    const tpl = await t.template('email');
    const r = await t.send({ channel: 'email', recipient: 'crash@example.com', template_id: tpl.id, payload: { name: 'A' } });
    const orphan = await ctx.container.queue.claim('worker-that-dies');
    assert.ok(orphan, 'worker A took the job and then "crashed" without finishing');
    assert.equal(await ctx.container.queue.claim('worker-b'), null, 'the lock is still held');
    await sleep(150);
    await ctx.drain();
    assert.equal((await t.get(r.body.id)).body.status, 'delivered');
    const sent = (await ctx.api('GET', '/api/dev/outbox', { token: t.token })).body.messages.filter((m) => m.recipient === 'crash@example.com');
    assert.equal(sent.length, 1);
  });

  it('if the provider already accepted the message before the crash, the retry does not send a second copy', async () => {
    const t = await ctx.newTenant('Dup');
    const tpl = await t.template('email');
    const r = await t.send({ channel: 'email', recipient: 'dup@example.com', template_id: tpl.id, payload: { name: 'A' } });
    const first = await ctx.container.queue.claim('worker-that-dies');
    // the provider accepted the message (idempotent by notification id) but the worker died before updating the status
    await ctx.container.repos.outbox.insertOnce({ id: 'pre', idemKey: r.body.id, tenantId: t.tenantId, channel: 'email', recipient: 'dup@example.com', subject: 's', body: 'b', createdAt: new Date().toISOString() });
    assert.ok(first);
    await sleep(150);
    await ctx.drain();
    assert.equal((await t.get(r.body.id)).body.status, 'delivered');
    const sent = (await ctx.api('GET', '/api/dev/outbox', { token: t.token })).body.messages.filter((m) => m.recipient === 'dup@example.com');
    assert.equal(sent.length, 1);
  });

  it('jobs of an unknown type are parked as dead instead of looping forever', async () => {
    await ctx.container.queue.enqueue('mystery', {});
    await ctx.drain();
    assert.equal((await ctx.container.queue.stats()).dead, 1);
  });
});
