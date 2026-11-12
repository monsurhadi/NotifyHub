'use strict';

/** Errors that map directly to an HTTP response. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const badRequest = (message, details, code = 'bad_request') => new AppError(400, code, message, details);
const unauthorized = (message = 'Authentication required', code = 'unauthorized') => new AppError(401, code, message);
const forbidden = (message = 'Forbidden', code = 'forbidden') => new AppError(403, code, message);
const notFound = (message = 'Not found', code = 'not_found') => new AppError(404, code, message);
const conflict = (message, code = 'conflict', details) => new AppError(409, code, message, details);
const tooLarge = (message, code = 'payload_too_large') => new AppError(413, code, message);
const unprocessable = (message, code = 'unprocessable', details) => new AppError(422, code, message, details);
const tooMany = (message, code = 'too_many_requests', details) => new AppError(429, code, message, details);

/** Delivery pipeline signals (thrown by the channel decorators, handled by DeliveryService). */
class RateLimitedError extends Error {
  constructor(retryAfterMs) { super('Rate limit reached, delivery deferred'); this.retryAfterMs = retryAfterMs; }
}
class RetryableDeliveryError extends Error {
  constructor(message, delayMs, cause) { super(message); this.delayMs = delayMs; this.cause = cause; }
}
class PermanentDeliveryError extends Error {
  constructor(message, cause) { super(message); this.cause = cause; }
}

module.exports = {
  AppError, badRequest, unauthorized, forbidden, notFound, conflict, tooLarge, unprocessable, tooMany,
  RateLimitedError, RetryableDeliveryError, PermanentDeliveryError,
};
