'use strict';
const { newId } = require('../util/crypto');
const { RateLimitedError, RetryableDeliveryError, PermanentDeliveryError, badRequest, notFound } = require('../domain/errors');
const { STATUS, FINAL_STATUSES } = require('../domain/constants');
const { RateLimitDecorator } = require('../decorators/RateLimitDecorator');
const { LoggingDecorator } = require('../decorators/LoggingDecorator');
const { RetryDecorator } = require('../decorators/RetryDecorator');

/**
 * Runs one delivery job. The channel (Strategy, picked by the Factory) is wrapped in decorators:
 *   RetryDecorator( LoggingDecorator( RateLimitDecorator( channel ) ) )
 * and the result is translated into a notification status + a decision for the worker.
 */
class DeliveryService {
  constructor({ config, notifications, attempts, tenants, channelFactory, limiter, eventBus, logger }) {
    Object.assign(this, { config, notifications, attempts, tenants, channelFactory, limiter, eventBus, logger });
  }

  _pipeline(channel) {
    return new RetryDecorator(
      new LoggingDecorator(new RateLimitDecorator(channel, this.limiter), { attemptsRepo: this.attempts, logger: this.logger }),
      { maxAttempts: this.config.maxDeliveryAttempts, baseMs: this.config.retryBaseMs, maxMs: this.config.retryMaxMs },
    );
  }

  _transition(n, previous, status, extra = {}) {
    return this.eventBus.publish('notification.status_changed', {
      tenantId: n.tenant_id, notificationId: n.id, previousStatus: previous, status, channel: n.channel,
      attempts: extra.attempts ?? n.attempts, error: extra.error ?? null,
    });
  }

  /** @returns {Promise<{done: true} | {reschedule: number}>} */
  async processDelivery({ notificationId }) {
    const n = await this.notifications.findByIdSystem(notificationId);
    if (!n) return { done: true };
    if (FINAL_STATUSES.includes(n.status)) return { done: true }; // duplicate job: never deliver twice

    const previous = n.status;
    const attempt = n.attempts + 1;
    await this.notifications.updateState(n.id, { status: STATUS.PROCESSING, lastError: n.last_error }, new Date().toISOString());
    const tenant = await this.tenants.findById(n.tenant_id);
    const message = {
      notificationId: n.id, tenantId: n.tenant_id, channel: n.channel, recipient: n.recipient,
      subject: n.subject, body: n.body, attempt, webhookSecret: tenant ? tenant.webhook_secret : null,
    };

    try {
      const result = await this._pipeline(this.channelFactory.create(n.channel)).send(message);
      const status = result.confirmed ? STATUS.DELIVERED : STATUS.SENT;
      await this.notifications.updateState(n.id, { status, attempts: attempt, lastError: null }, new Date().toISOString());
      await this._transition(n, previous, status, { attempts: attempt });
      return { done: true };
    } catch (err) {
      const now = new Date().toISOString();
      if (err instanceof RateLimitedError) {
        // Not an attempt: put it back and try again when the rate window has reset (FR-10, never dropped).
        await this.notifications.updateState(n.id, { status: previous, lastError: n.last_error }, now);
        return { reschedule: Date.now() + err.retryAfterMs };
      }
      if (err instanceof RetryableDeliveryError) {
        await this.notifications.updateState(n.id, { status: STATUS.RETRYING, attempts: attempt, lastError: err.message }, now);
        await this._transition(n, previous, STATUS.RETRYING, { attempts: attempt, error: err.message });
        this.logger.info('delivery will be retried', { notificationId: n.id, attempt, delayMs: err.delayMs });
        return { reschedule: Date.now() + err.delayMs };
      }
      if (err instanceof PermanentDeliveryError) {
        await this.notifications.updateState(n.id, { status: STATUS.FAILED, attempts: attempt, lastError: err.message }, now);
        await this._transition(n, previous, STATUS.FAILED, { attempts: attempt, error: err.message });
        this.logger.warn('delivery failed permanently', { notificationId: n.id, attempts: attempt });
        return { done: true };
      }
      throw err; // unexpected (e.g. database trouble): the worker reschedules the job
    }
  }

  /** Delivery receipt from a provider (FR-11): sent -> delivered / failed. */
  async applyProviderCallback(notificationId, status) {
    if (![STATUS.DELIVERED, STATUS.FAILED].includes(status)) throw badRequest('status must be "delivered" or "failed"', { field: 'status' });
    const n = await this.notifications.findByIdSystem(notificationId);
    if (!n) throw notFound('Notification not found', 'notification_not_found');
    if (n.status === status) return { id: n.id, status };
    await this.notifications.updateState(n.id, { status, lastError: status === STATUS.FAILED ? 'Provider reported a delivery failure' : null }, new Date().toISOString());
    await this.attempts.add({ id: newId(), notificationId: n.id, tenantId: n.tenant_id, attemptNumber: n.attempts, status: `callback_${status}`, createdAt: new Date().toISOString() });
    await this._transition(n, n.status, status);
    return { id: n.id, status };
  }
}
module.exports = { DeliveryService };
