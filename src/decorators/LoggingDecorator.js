'use strict';
const { ChannelDecorator } = require('./ChannelDecorator');
const { RateLimitedError } = require('../domain/errors');
const { newId } = require('../util/crypto');

/** NFR-09: records every real delivery attempt (success or failure) with timestamp and error. */
class LoggingDecorator extends ChannelDecorator {
  constructor(inner, { attemptsRepo, logger }) { super(inner); this.attempts = attemptsRepo; this.logger = logger; }

  async _record(message, status, extra = {}) {
    await this.attempts.add({
      id: newId(), notificationId: message.notificationId, tenantId: message.tenantId,
      attemptNumber: message.attempt, status, createdAt: new Date().toISOString(), ...extra,
    });
  }

  async send(message) {
    try {
      const result = await this.inner.send(message);
      if (!result || !result.providerMessageId) throw new Error('Provider returned no message id (delivery uncertain)');
      await this._record(message, 'success', { providerMessageId: result.providerMessageId });
      return result;
    } catch (err) {
      if (err instanceof RateLimitedError) throw err; // a deferral is not an attempt
      const reason = (err.cause && err.cause.message) || err.message;
      await this._record(message, 'failed', { error: reason });
      this.logger.warn('delivery attempt failed', { notificationId: message.notificationId, attempt: message.attempt, reason });
      throw err;
    }
  }
}
module.exports = { LoggingDecorator };
