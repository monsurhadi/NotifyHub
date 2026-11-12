'use strict';
const { AppError } = require('../domain/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'route_not_found', message: `No route for ${req.method} ${req.path}` } });
}

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'malformed_json', message: 'Request body is not valid JSON' } });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
    logger.error('unhandled error', { method: req.method, path: req.path, err: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side' } });
  };
}
module.exports = { errorHandler, notFoundHandler };
