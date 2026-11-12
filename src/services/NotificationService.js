'use strict';
const { newId } = require('../util/crypto');
const { AppError, badRequest, notFound, tooLarge, unprocessable, tooMany } = require('../domain/errors');
const { isPlainObject, recipientProblem } = require('../domain/validators');
const { render, missingKeys } = require('../domain/templateEngine');
const { STATUS } = require('../domain/constants');
const { isUniqueViolation } = require('../db/createDatabase');
const { maskRecipient } = require('../util/mask');

/** Which rendered parts get HTML-escaped values (prevents markup injection through payload values). */
const ESCAPE = {
  email: { subject: false, body: true },
  'in-app': { subject: true, body: true },
  sms: { subject: false, body: false },
  whatsapp: { subject: false, body: false },
  telegram: { subject: false, body: false },
  webhook: { subject: false, body: false },
};
const period = () => new Date().toISOString().slice(0, 7);

const toApi = (n) => ({
  id: n.id, channel: n.channel, recipient: n.recipient, status: n.status, attempts: n.attempts,
  templateId: n.template_id, templateVersion: n.template_version, lastError: n.last_error, createdAt: n.created_at, updatedAt: n.updated_at,
});

/** FR-06 / FR-07: validates, renders, reserves plan quota, stores and queues notifications. */
class NotificationService {
  constructor({ config, db, notifications, attempts, templates, tenants, usage, queue, channelFactory, eventBus }) {
    Object.assign(this, { config, db, notifications, attempts, templates, tenants, usage, queue, channelFactory, eventBus });
  }

  _channel(input) {
    if (typeof input.channel !== 'string' || !input.channel) throw badRequest('channel is required', { field: 'channel' });
    if (!this.channelFactory.supports(input.channel)) {
      throw badRequest(`Unsupported channel "${input.channel}". Supported: ${this.channelFactory.names().join(', ')}`, { field: 'channel' }, 'unsupported_channel');
    }
    return input.channel;
  }

  async _template(tenantId, templateId, channel) {
    if (typeof templateId !== 'string' || !templateId) throw badRequest('template_id is required', { field: 'template_id' });
    const tpl = await this.templates.findById(tenantId, templateId);
    if (!tpl) throw notFound('Template not found', 'template_not_found');
    if (tpl.status === 'archived') throw unprocessable('This template is archived and cannot be used', 'template_archived');
    if (tpl.channel !== channel) {
      throw unprocessable(`Template channel mismatch: the template is for "${tpl.channel}" but the request channel is "${channel}"`, 'template_channel_mismatch');
    }
    return tpl;
  }

  _render(tpl, channel, payload) {
    const placeholders = JSON.parse(tpl.placeholders);
    const missing = missingKeys(placeholders, payload);
    if (missing.length) throw unprocessable(`Missing values for placeholders: ${missing.join(', ')}`, 'missing_placeholders', { missing });
    const esc = ESCAPE[channel] || { subject: false, body: false };
    return {
      subject: tpl.subject ? render(tpl.subject, payload, { escape: esc.subject }) : null,
      body: render(tpl.body, payload, { escape: esc.body }),
    };
  }

  _row(tenantId, tpl, channel, recipient, payload, rendered) {
    const now = new Date().toISOString();
    return {
      id: newId(), tenantId, templateId: tpl.id, templateVersion: tpl.current_version, channel, recipient, payload,
      subject: rendered.subject, body: rendered.body, status: STATUS.QUEUED, createdAt: now,
    };
  }

  async _limit(tenantId) {
    const tenant = await this.tenants.findById(tenantId);
    const plan = this.config.plans[tenant.plan] || this.config.plans.free;
    return plan.monthlyLimit;
  }

  _announce(tenantId, n) {
    return this.eventBus.publish('notification.status_changed', {
      tenantId, notificationId: n.id, previousStatus: null, status: STATUS.QUEUED, channel: n.channel, attempts: 0, error: null,
    });
  }

  async create(tenantId, input, { idempotencyKey } = {}) {
    if (!isPlainObject(input)) throw badRequest('Request body must be a JSON object');
    if (idempotencyKey) {
      const seen = await this.usage.findIdempotency(tenantId, idempotencyKey);
      if (seen) return { ...(await this.get(tenantId, seen.notification_id)), duplicate: true };
    }
    const channel = this._channel(input);
    const problem = recipientProblem(channel, input.recipient, this.config);
    if (problem) throw badRequest(problem, { field: 'recipient' }, 'invalid_recipient');
    if (input.payload !== undefined && !isPlainObject(input.payload)) throw badRequest('payload must be a JSON object', { field: 'payload' });
    const payload = input.payload || {};
    const tpl = await this._template(tenantId, input.template_id, channel);
    const rendered = this._render(tpl, channel, payload);
    const row = this._row(tenantId, tpl, channel, input.recipient, payload, rendered);
    const limit = await this._limit(tenantId);

    try {
      await this.db.transaction(async (tx) => {
        const reserved = await this.usage.reserve(tenantId, period(), 1, limit, tx);
        if (reserved === null) throw tooMany(`Monthly plan limit of ${limit} notifications reached. Upgrade your plan to send more.`, 'plan_limit_reached', { limit });
        await this.notifications.create(row, tx);
        await this.queue.enqueue('deliver', { notificationId: row.id }, {}, tx);
        if (idempotencyKey) await this.usage.addIdempotency(tenantId, idempotencyKey, row.id, tx);
      });
    } catch (err) {
      if (idempotencyKey && isUniqueViolation(err)) {
        const seen = await this.usage.findIdempotency(tenantId, idempotencyKey);
        if (seen) return { ...(await this.get(tenantId, seen.notification_id)), duplicate: true };
      }
      throw err;
    }
    await this._announce(tenantId, row);
    return { id: row.id, status: STATUS.QUEUED, channel, createdAt: row.createdAt };
  }

  async createBulk(tenantId, input) {
    if (!isPlainObject(input)) throw badRequest('Request body must be a JSON object');
    const channel = this._channel(input);
    if (!Array.isArray(input.recipients) || input.recipients.length === 0) throw badRequest('recipients must be a non-empty array (1 to ' + this.config.bulkMax + ' entries)', { field: 'recipients' });
    if (input.recipients.length > this.config.bulkMax) {
      throw tooLarge(`A bulk request accepts at most ${this.config.bulkMax} recipients (received ${input.recipients.length})`, 'batch_too_large');
    }
    if (input.payload !== undefined && !isPlainObject(input.payload)) throw badRequest('payload must be a JSON object', { field: 'payload' });
    const common = input.payload || {};
    const tpl = await this._template(tenantId, input.template_id, channel);

    const results = new Array(input.recipients.length);
    const valid = [];
    input.recipients.forEach((item, index) => {
      const recipient = typeof item === 'string' ? item : item && item.recipient;
      const own = item && typeof item === 'object' && isPlainObject(item.payload) ? item.payload : {};
      const problem = recipientProblem(channel, recipient, this.config);
      if (problem) { results[index] = { index, recipient: typeof recipient === 'string' ? recipient : null, status: 'rejected', error: { code: 'invalid_recipient', message: problem } }; return; }
      const payload = { ...common, ...own };
      try {
        valid.push({ index, row: this._row(tenantId, tpl, channel, recipient, payload, this._render(tpl, channel, payload)) });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results[index] = { index, recipient, status: 'rejected', error: { code: err.code, message: err.message } };
      }
    });

    const limit = await this._limit(tenantId);
    const remaining = Math.max(0, limit - (await this.usage.get(tenantId, period())));
    const accepted = valid.slice(0, remaining);
    for (const v of valid.slice(remaining)) {
      results[v.index] = { index: v.index, recipient: v.row.recipient, status: 'rejected', error: { code: 'plan_limit_reached', message: `Monthly plan limit of ${limit} reached` } };
    }
    if (accepted.length === 0) {
      if (valid.length > 0) throw tooMany(`Monthly plan limit of ${limit} notifications reached. Upgrade your plan to send more.`, 'plan_limit_reached', { limit });
      throw badRequest('None of the recipients in this batch could be accepted', { results }, 'batch_rejected');
    }

    await this.db.transaction(async (tx) => {
      const reserved = await this.usage.reserve(tenantId, period(), accepted.length, limit, tx);
      if (reserved === null) throw tooMany(`Monthly plan limit of ${limit} notifications reached. Upgrade your plan to send more.`, 'plan_limit_reached', { limit });
      for (const { row } of accepted) {
        await this.notifications.create(row, tx);
        await this.queue.enqueue('deliver', { notificationId: row.id }, {}, tx);
      }
    });
    for (const { index, row } of accepted) results[index] = { index, notificationId: row.id, status: STATUS.QUEUED };
    for (const { row } of accepted) await this._announce(tenantId, row);
    return { accepted: accepted.length, rejected: results.length - accepted.length, results };
  }

  async get(tenantId, id) {
    const n = await this.notifications.findById(tenantId, id);
    if (!n) throw notFound('Notification not found', 'notification_not_found');
    const attempts = await this.attempts.list(tenantId, id);
    return {
      ...toApi(n), subject: n.subject, body: n.body,
      deliveryAttempts: attempts.map((a) => ({ attempt: a.attempt_number, status: a.status, error: a.error, providerMessageId: a.provider_message_id, at: a.created_at })),
    };
  }

  async list(tenantId, query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const rows = await this.notifications.list(tenantId, { status: query.status, channel: query.channel, limit, offset });
    return rows.map((n) => ({ ...toApi(n), recipient: maskRecipient(n.recipient) }));
  }
}
module.exports = { NotificationService };
