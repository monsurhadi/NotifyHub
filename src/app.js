'use strict';
const path = require('node:path');
const express = require('express');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const v1Routes = require('./routes/v1');
const { ipRateLimit } = require('./middleware/ipRateLimit');

function createApp(container) {
  const { config, logger } = container;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    });
    next();
  });
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const urlPath = req.originalUrl.split('?')[0];
      if (urlPath === '/health') return;
      logger.info('request', { method: req.method, path: urlPath, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });
  // Compressed JSON bodies are not needed by this API; disabling inflate also
  // avoids exercising body-parser's compressed-body parsing code path.
  app.use(express.json({ limit: '2mb', inflate: false }));

  app.use('/api', ipRateLimit({ windowMs: 60_000, max: 300 }));
  app.use('/v1', ipRateLimit({ windowMs: 60_000, max: 600 }));
  app.use(publicRoutes(container));
  app.use(adminRoutes(container));
  app.use('/v1', v1Routes(container));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
module.exports = { createApp };
