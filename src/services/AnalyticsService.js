'use strict';
const { badRequest } = require('../domain/errors');
const { CHANNELS, BUCKETS, bucketOf } = require('../domain/constants');
const { maskRecipient } = require('../util/mask');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const emptyBucket = () => ({ total: 0, delivered: 0, failed: 0, pending: 0 });

/** FR-13 dashboard numbers and FR-14 CSV export. Everything is scoped to one tenant. */
class AnalyticsService {
  constructor({ notifications }) { this.notifications = notifications; }

  _filter(q = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const to = q.to || today;
    const from = q.from || new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
    if (!isRealDate(from) || !isRealDate(to)) throw badRequest('from and to must be dates in YYYY-MM-DD format', undefined, 'invalid_date');
    if (from > to) throw badRequest('End date must not be earlier than start date', { from, to }, 'invalid_date_range');
    const channel = q.channel || undefined;
    if (channel && !CHANNELS.includes(channel)) throw badRequest(`channel must be one of: ${CHANNELS.join(', ')}`, { field: 'channel' });
    let statuses;
    if (q.status) {
      const s = String(q.status).toLowerCase();
      statuses = BUCKETS[s] || (Object.values(BUCKETS).flat().includes(s) ? [s] : null);
      if (!statuses) throw badRequest('status must be delivered, failed, pending or a raw status', { field: 'status' });
    }
    return { from, to, channel, statuses };
  }

  async summary(tenantId, query) {
    const filter = this._filter(query);
    const rows = await this.notifications.aggregate(tenantId, filter);
    const totals = emptyBucket();
    const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, emptyBucket()]));
    const byStatus = {};
    for (const r of rows) {
      const b = bucketOf(r.status);
      for (const target of [totals, byChannel[r.channel] || (byChannel[r.channel] = emptyBucket())]) { target.total += r.n; target[b] += r.n; }
      byStatus[r.status] = (byStatus[r.status] || 0) + r.n;
    }
    const days = new Map();
    for (const r of await this.notifications.byDay(tenantId, filter)) {
      const d = days.get(r.day) || { date: r.day, ...emptyBucket() };
      d.total += r.n; d[bucketOf(r.status)] += r.n;
      days.set(r.day, d);
    }
    return { range: { from: filter.from, to: filter.to }, totals, byChannel, byStatus, byDay: [...days.values()], generatedAt: new Date().toISOString() };
  }

  async exportCsv(tenantId, query) {
    const rows = await this.notifications.exportRows(tenantId, this._filter(query));
    // Cells starting with = + - @ would be executed as formulas by spreadsheet apps, so they are prefixed with '
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    const lines = ['notification_id,channel,recipient,status,attempts,created_at,updated_at'];
    for (const r of rows) lines.push([r.id, r.channel, maskRecipient(r.recipient), r.status, r.attempts, r.created_at, r.updated_at].map(cell).join(','));
    return lines.join('\n') + '\n';
  }
}
module.exports = { AnalyticsService };
