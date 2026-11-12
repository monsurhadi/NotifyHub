'use strict';
const { ChannelDecorator } = require('./ChannelDecorator');
const { RateLimitedError, RetryableDeliveryError, PermanentDeliveryError } = require('../domain/errors');

/**
 * FR-09: turns a raw channel failure into a retry decision with exponential backoff.
 * attempt 1 fails -> retry after base, attempt 2 -> 2x base, attempt 3 -> 4x base ...
 * After `maxAttempts` the failure becomes permanent.
 */
class RetryDecorator extends ChannelDecorator {
  constructor(inner, { maxAttempts, baseMs, maxMs }) {
    super(inner);
    this.maxAttempts = maxAttempts;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
  }
  async send(message) {
    try {
      return await this.inner.send(message);
    } catch (err) {
      if (err instanceof RateLimitedError || err instanceof PermanentDeliveryError) throw err;
      if (message.attempt >= this.maxAttempts) throw new PermanentDeliveryError(err.message, err);
      const delay = Math.min(this.baseMs * 2 ** (message.attempt - 1), this.maxMs);
      throw new RetryableDeliveryError(err.message, delay, err);
    }
  }
}
module.exports = { RetryDecorator };
