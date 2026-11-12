'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor } = require('./helpers');

describe('several workers at the same time (NFR-02 scalability, NFR-05 at-least-once without duplicates)', () => {
  let ctx;
  before(async () => { ctx = await startApp({ workerConcurrency: 4 }); });
  after(async () => { await ctx.stop(); });

  it('4 workers share 120 jobs: every notification is delivered exactly once', async () => {
    const t = await ctx.newTenant('Scale');
    const tpl = await t.template('email');
    const recipients = Array.from({ length: 120 }, (_, i) => `user${i}@example.com`);
    const r = await ctx.api('POST', '/v1/notifications/bulk', { key: t.key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'F' }, recipients } });
    assert.equal(r.body.accepted, 120);

    const workers = [1, 2, 3, 4].map((n) => ctx.container.createWorker(`w${n}`));
    workers.forEach((w) => w.start());
    try {
      await waitFor(async () => { const s = await ctx.container.queue.stats(); return s.queued === 0 && s.processing === 0; }, 30000, 50);
    } finally { await Promise.all(workers.map((w) => w.stop())); }

    const db = ctx.container.db;
    const byStatus = await db.all('SELECT status, COUNT(*) AS n FROM notifications WHERE tenant_id = ? GROUP BY status', [t.tenantId]);
    assert.deepEqual(byStatus, [{ status: 'delivered', n: 120 }]);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM delivery_attempts WHERE tenant_id = ?', [t.tenantId])).n, 120, 'exactly one attempt per notification');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM notifications WHERE tenant_id = ? AND attempts <> 1', [t.tenantId])).n, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM outbox WHERE idem_key IN (SELECT id FROM notifications WHERE tenant_id = ?)', [t.tenantId])).n, 120, 'one message per notification, no duplicates');
    const stats = await ctx.container.queue.stats();
    assert.equal(stats.dead, 0);
  });
});
