'use strict';
const express = require('express');
const { wrap, authenticate, requireSecret } = require('../middleware/auth');
const { badRequest, notFound } = require('../domain/errors');
const { CHANNELS } = require('../domain/constants');

/** Dashboard-only (JWT) endpoints: account, API keys, webhooks, rate limits, billing, operator overview. */
module.exports = ({ services, repos, limiter, config }) => {
  const r = express.Router();
  const jwt = authenticate(services.auth, 'jwt');

  r.get('/api/me', jwt, wrap(async (req, res) => res.json(await services.auth.me(req.auth.tenantId, req.auth.userId))));

  r.get('/api/providers/status', jwt, wrap(async (req, res) => {
    const twilioConfigured = config.sms.provider === 'twilio' && !!(config.sms.accountSid && config.sms.authToken && (config.sms.from || config.sms.messagingServiceSid));
    res.json({ providers: {
      email: { provider: config.smtp.host ? 'smtp' : 'simulator', configured: !!(config.smtp.host && config.smtp.user && config.smtp.pass) },
      sms: { provider: config.sms.provider, configured: config.sms.provider === 'simulated' || twilioConfigured },
      whatsapp: { provider: 'meta-cloud-api', configured: !!(config.whatsapp.accessToken && config.whatsapp.phoneNumberId && config.whatsapp.apiVersion) },
      telegram: { provider: 'telegram-bot-api', configured: !!config.telegram.botToken },
    } });
  }));

  // API keys (FR-03)
  r.get('/api/keys', jwt, wrap(async (req, res) => res.json({ keys: await services.apiKeys.list(req.auth.tenantId) })));
  r.post('/api/keys', jwt, wrap(async (req, res) => res.status(201).json(await services.apiKeys.create(req.auth.tenantId, req.body && req.body.name))));
  r.delete('/api/keys/:id', jwt, wrap(async (req, res) => res.json(await services.apiKeys.revoke(req.auth.tenantId, req.params.id))));

  // Webhooks (FR-12)
  r.get('/api/webhooks', jwt, wrap(async (req, res) => res.json(await services.webhooks.overview(req.auth.tenantId))));
  r.post('/api/webhooks', jwt, wrap(async (req, res) => res.status(201).json(await services.webhooks.register(req.auth.tenantId, req.body && req.body.url))));
  r.delete('/api/webhooks/:id', jwt, wrap(async (req, res) => res.json(await services.webhooks.remove(req.auth.tenantId, req.params.id))));
  r.get('/api/webhooks/attempts', jwt, wrap(async (req, res) => res.json({ attempts: await services.webhooks.attempts(req.auth.tenantId, req.query.limit) })));

  // Rate limits (FR-10)
  r.get('/api/rate-limits', jwt, wrap(async (req, res) => {
    const stored = new Map((await repos.rateLimits.list(req.auth.tenantId)).map((x) => [x.channel, x.per_minute]));
    res.json({ windowSeconds: config.rateWindowMs / 1000, limits: CHANNELS.map((c) => ({ channel: c, perMinute: stored.get(c) ?? config.defaultRatePerMinute, isDefault: !stored.has(c) })) });
  }));
  r.put('/api/rate-limits', jwt, wrap(async (req, res) => {
    const { channel, perMinute } = req.body || {};
    if (!CHANNELS.includes(channel)) throw badRequest(`channel must be one of: ${CHANNELS.join(', ')}`, { field: 'channel' });
    if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 100000) throw badRequest('perMinute must be a whole number between 1 and 100000', { field: 'perMinute' });
    await repos.rateLimits.set(req.auth.tenantId, channel, perMinute);
    limiter.clearCache(req.auth.tenantId, channel);
    res.json({ channel, perMinute, note: 'Takes effect within a few seconds, no restart needed.' });
  }));

  // Billing (FR-15, FR-16)
  r.get('/api/billing', jwt, wrap(async (req, res) => res.json(await services.billing.overview(req.auth.tenantId))));
  r.post('/api/billing/checkout', jwt, wrap(async (req, res) => res.status(201).json(await services.billing.startCheckout(req.auth.tenantId))));
  r.post('/api/billing/checkout/:id/pay', jwt, wrap(async (req, res) => res.json(await services.billing.pay(req.auth.tenantId, req.params.id, req.body))));
  r.post('/api/billing/checkout/:id/confirm', jwt, wrap(async (req, res) => res.json(await services.billing.confirm(req.auth.tenantId, req.params.id))));
  r.post('/api/billing/checkout/:id/cancel', jwt, wrap(async (req, res) => res.json(await services.billing.cancel(req.auth.tenantId, req.params.id))));

  // What the simulated e-mail / SMS provider "sent" (development helper, disabled in production)
  r.get('/api/dev/outbox', jwt, wrap(async (req, res) => {
    if (config.env === 'production') throw notFound('Not available in production');
    res.json({ messages: await repos.outbox.list(req.auth.tenantId) });
  }));

  // Platform Administrator
  r.get('/api/platform/overview', requireSecret('x-admin-token', config.adminToken), wrap(async (req, res) => res.json(await services.platform.overview())));
  return r;
};
