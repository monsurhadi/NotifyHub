'use strict';
const { newId, hmacHex } = require('../util/crypto');
const { badRequest, notFound, conflict } = require('../domain/errors');
const { isHttpUrl, assertPublicTarget, fetchPublicTarget } = require('../domain/validators');

const MAX_ENDPOINTS = 5;

/** FR-12: endpoint registration, signed status-change events, retries (max 3 after the first try). */
class WebhookService {
  constructor({ config, repo, tenants, queue, logger }) { Object.assign(this, { config, repo, tenants, queue, logger }); }

  _checkUrl(url) {
    if (typeof url !== 'string' || !isHttpUrl(url, { allowHttp: this.config.env !== 'production' })) {
      throw badRequest('url must be a valid ' + (this.config.env === 'production' ? 'https' : 'http(s)') + ' URL', { field: 'url' }, 'invalid_webhook_url');
    }
  }

  async register(tenantId, url) {
    this._checkUrl(url);
    await assertPublicTarget(url, this.config.allowPrivateWebhookTargets);
    if ((await this.repo.listEndpoints(tenantId)).length >= MAX_ENDPOINTS) throw conflict(`At most ${MAX_ENDPOINTS} webhook endpoints are allowed`, 'too_many_endpoints');
    const e = { id: newId(), tenantId, url, createdAt: new Date().toISOString() };
    await this.repo.createEndpoint(e);
    return { id: e.id, url, createdAt: e.createdAt };
  }

  async overview(tenantId) {
    const tenant = await this.tenants.findById(tenantId);
    const endpoints = await this.repo.listEndpoints(tenantId);
    return { signingSecret: tenant.webhook_secret, endpoints: endpoints.map((e) => ({ id: e.id, url: e.url, createdAt: e.created_at })) };
  }

  async remove(tenantId, id) {
    if (!(await this.repo.deactivate(tenantId, id))) throw notFound('Webhook endpoint not found', 'webhook_not_found');
    return { id, removed: true };
  }

  async attempts(tenantId, limit) {
    const rows = await this.repo.listAttempts(tenantId, Math.min(parseInt(limit, 10) || 50, 200));
    return rows.map((a) => ({ id: a.id, url: a.url, eventId: a.event_id, notificationId: a.notification_id, attempt: a.attempt_number, httpStatus: a.http_status, error: a.error, success: !!a.success, at: a.created_at }));
  }

  /** Observer: called for every status change, queues one signed POST per active endpoint. */
  async enqueueEvent(change) {
    if (change.status === 'processing') return; // internal, transient state
    const endpoints = await this.repo.listEndpoints(change.tenantId);
    if (!endpoints.length) return;
    const event = {
      id: `evt_${newId()}`, type: 'notification.status_changed', created_at: new Date().toISOString(),
      data: { notification_id: change.notificationId, status: change.status, previous_status: change.previousStatus, channel: change.channel, attempts: change.attempts, error: change.error },
    };
    for (const e of endpoints) await this.queue.enqueue('webhook', { tenantId: change.tenantId, endpointId: e.id, event, attempt: 1 });
  }

  async processDelivery(payload) {
    const endpoint = await this.repo.findEndpoint(payload.tenantId, payload.endpointId);
    if (!endpoint || !endpoint.active) return { done: true };
    const tenant = await this.tenants.findById(payload.tenantId);
    const body = JSON.stringify(payload.event);
    const headers = {
      'content-type': 'application/json', 'user-agent': 'NotifyHub-Webhook/1.0', 'x-notifyhub-event': payload.event.type,
      'x-notifyhub-delivery': payload.event.id, 'x-notifyhub-signature': `sha256=${hmacHex(tenant.webhook_secret, body)}`,
    };
    let httpStatus = null;
    let error = null;
    let ok = false;
    try {
      const res = await fetchPublicTarget(endpoint.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.config.webhookTimeoutMs) }, this.config.allowPrivateWebhookTargets);
      httpStatus = res.status;
      ok = res.status >= 200 && res.status < 300;
      if (!ok) error = `HTTP ${res.status}`;
    } catch (err) {
      if (err.code === 'invalid_webhook_url') {
        await this.repo.addAttempt({ id: newId(), tenantId: payload.tenantId, endpointId: endpoint.id, eventId: payload.event.id, notificationId: payload.event.data.notification_id,
          attemptNumber: payload.attempt, httpStatus: null, error: 'Blocked unsafe webhook target', success: false, createdAt: new Date().toISOString() });
        this.logger.warn('webhook delivery blocked', { endpointId: endpoint.id, reason: err.message });
        return { done: true };
      }
      error = err.name === 'TimeoutError' ? 'Timeout' : err.message;
    }
    await this.repo.addAttempt({
      id: newId(), tenantId: payload.tenantId, endpointId: endpoint.id, eventId: payload.event.id, notificationId: payload.event.data.notification_id,
      attemptNumber: payload.attempt, httpStatus, error, success: ok, createdAt: new Date().toISOString(),
    });
    if (ok) return { done: true };
    if (payload.attempt >= 1 + this.config.webhookMaxRetries) {
      this.logger.warn('webhook delivery given up', { endpointId: endpoint.id, eventId: payload.event.id, attempts: payload.attempt });
      return { done: true };
    }
    return { reschedule: Date.now() + this.config.webhookRetryBaseMs * 2 ** (payload.attempt - 1), payload: { ...payload, attempt: payload.attempt + 1 } };
  }
}
module.exports = { WebhookService };
