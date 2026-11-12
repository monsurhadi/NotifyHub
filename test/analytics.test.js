'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

/**
 * Known dataset for tenant A (20 notifications over 3 days):
 *   day 1: email 4 (3 ok, 1 failed), sms 2, webhook 2          = 8
 *   day 2: email 4, sms 2 (1 ok, 1 failed), webhook 1          = 7
 *   day 3: email 2 (1 ok, 1 failed), sms 2, webhook 1          = 5
 * Totals: email 10 (8/2), sms 6 (5/1), webhook 4 (4/0). Tenant B gets 50 unrelated rows.
 */
describe('analytics dashboard and CSV export (FR-13, FR-14)', () => {
  let ctx; let A; let B;
  const D1 = '2026-03-01'; const D2 = '2026-03-02'; const D3 = '2026-03-03';

  async function insert(tenant, tplId, day, channel, recipient, status, i) {
    const id = `seed-${tenant.tenantId.slice(0, 6)}-${day}-${channel}-${i}`;
    await ctx.container.repos.notifications.create({
      id, tenantId: tenant.tenantId, templateId: tplId, templateVersion: 1, channel, recipient, payload: {}, subject: null, body: 'seed',
      status, createdAt: `${day}T10:00:0${i % 10}.000Z`,
    });
  }

  before(async () => {
    ctx = await startApp();
    A = await ctx.newTenant('DataA');
    B = await ctx.newTenant('DataB');
    const tplA = (await A.template('email')).id;
    const tplB = (await B.template('email')).id;
    const seed = [
      [D1, 'email', 'asha@example.com', ['delivered', 'delivered', 'delivered', 'failed']],
      [D1, 'sms', '+8801712345678', ['delivered', 'delivered']],
      [D1, 'webhook', 'https://client.example.com/hook', ['delivered', 'delivered']],
      [D2, 'email', 'asha@example.com', ['delivered', 'delivered', 'delivered', 'delivered']],
      [D2, 'sms', '+8801712345678', ['delivered', 'failed']],
      [D2, 'webhook', 'https://client.example.com/hook', ['delivered']],
      [D3, 'email', 'asha@example.com', ['delivered', 'failed']],
      [D3, 'sms', '+8801712345678', ['delivered', 'delivered']],
      [D3, 'webhook', 'https://client.example.com/hook', ['delivered']],
    ];
    for (const [day, channel, recipient, statuses] of seed) {
      for (let i = 0; i < statuses.length; i += 1) await insert(A, tplA, day, channel, recipient, statuses[i], i);
    }
    for (let i = 0; i < 50; i += 1) await insert(B, tplB, [D1, D2, D3][i % 3], 'email', `b-user-${i}@other.test`, i % 5 === 0 ? 'failed' : 'delivered', i);
  });
  after(async () => { await ctx.stop(); });

  const summary = (q = '') => ctx.api('GET', `/v1/analytics/summary${q}`, { key: A.key });

  it('all three days: totals and per-channel counts match the dataset', async () => {
    const r = await summary(`?from=${D1}&to=${D3}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.totals, { total: 20, delivered: 17, failed: 3, pending: 0 });
    assert.deepEqual(r.body.byChannel.email, { total: 10, delivered: 8, failed: 2, pending: 0 });
    assert.deepEqual(r.body.byChannel.sms, { total: 6, delivered: 5, failed: 1, pending: 0 });
    assert.deepEqual(r.body.byChannel.webhook, { total: 4, delivered: 4, failed: 0, pending: 0 });
    assert.deepEqual(r.body.byDay.map((d) => [d.date, d.total]), [[D1, 8], [D2, 7], [D3, 5]]);
  });

  it('filters by day, channel and status', async () => {
    const day2 = await summary(`?from=${D2}&to=${D2}`);
    assert.deepEqual(day2.body.totals, { total: 7, delivered: 6, failed: 1, pending: 0 });
    const email = await summary(`?from=${D1}&to=${D3}&channel=email`);
    assert.deepEqual(email.body.totals, { total: 10, delivered: 8, failed: 2, pending: 0 });
    const failed = await summary(`?from=${D1}&to=${D3}&status=Failed`);
    assert.equal(failed.body.totals.total, 3);
    assert.equal(failed.body.byChannel.email.total, 2);
    assert.equal(failed.body.byChannel.sms.total, 1);
  });

  it('an empty range shows zeros; an invalid range or date is a clear 400', async () => {
    const empty = await summary('?from=2026-03-05&to=2026-03-05');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.totals, { total: 0, delivered: 0, failed: 0, pending: 0 });
    assert.deepEqual(empty.body.byDay, []);
    const backwards = await summary(`?from=${D3}&to=${D1}`);
    assert.equal(backwards.status, 400);
    assert.equal(backwards.body.error.code, 'invalid_date_range');
    assert.equal((await summary('?from=2026-02-31&to=2026-03-01')).status, 400);
    assert.equal((await summary('?from=yesterday')).status, 400);
  });

  it('a notification delivered now shows up straight away', async () => {
    const tpl = await A.template('email');
    const today = new Date().toISOString().slice(0, 10);
    const before = (await summary(`?from=${today}&to=${today}`)).body.totals.total;
    await A.send({ channel: 'email', recipient: 'live@example.com', template_id: tpl.id, payload: { name: 'A' } });
    const queued = (await summary(`?from=${today}&to=${today}`)).body.totals;
    assert.equal(queued.total, before + 1);
    assert.equal(queued.pending, 1);
    await ctx.drain();
    assert.equal((await summary(`?from=${today}&to=${today}`)).body.totals.delivered, 1);
  });

  it('CSV export: header + 20 rows, masked recipients, formula-safe, no other tenant data', async () => {
    const r = await ctx.api('GET', `/v1/analytics/export.csv?from=${D1}&to=${D3}`, { key: A.key });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    const lines = r.body.trim().split('\n');
    assert.equal(lines[0], 'notification_id,channel,recipient,status,attempts,created_at,updated_at');
    assert.equal(lines.length, 21);
    assert.ok(r.body.includes('"a***@example.com"'));
    assert.ok(!r.body.includes('asha@example.com'));
    assert.ok(!r.body.includes('+8801712345678'));
    assert.ok(r.body.includes('"\'+880'), 'cells that start with + are neutralised for spreadsheets');
    assert.ok(!r.body.includes('other.test'));
    assert.ok(!r.body.includes('b-user'));
  });
});
