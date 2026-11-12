'use strict';
const express = require('express');
const { wrap, requireSecret } = require('../middleware/auth');
const { ipRateLimit } = require('../middleware/ipRateLimit');

/** Unauthenticated endpoints: health, account creation/recovery and provider receipts. */
module.exports = ({ services, config }) => {
  const r = express.Router();
  r.get('/health', wrap(async (req, res) => res.json(await services.platform.health())));
  r.post('/api/register', ipRateLimit({ windowMs: 60 * 60_000, max: 10, code: 'registration_rate_limited', message: 'Too many workspaces created from this network. Try again later.' }), wrap(async (req, res) => res.status(201).json({ tenant: await services.auth.register(req.body), message: 'Workspace created. Verify your email before signing in.' })));
  r.post('/api/auth/login', ipRateLimit({ windowMs: 15 * 60_000, max: 20, code: 'login_rate_limited', message: 'Too many sign-in attempts from this network. Try again later.' }), wrap(async (req, res) => res.json(await services.auth.login(req.body))));
  r.post('/api/auth/verify-email', ipRateLimit({ windowMs: 60 * 60_000, max: 20 }), wrap(async (req, res) => res.json(await services.auth.verifyEmail(req.body?.token))));
  r.post('/api/auth/verification', ipRateLimit({ windowMs: 15 * 60_000, max: 8, code: 'verification_rate_limited', message: 'Too many verification requests. Try again later.' }), wrap(async (req, res) => res.json(await services.auth.requestEmailVerification(req.body))));
  r.post('/api/auth/password-reset', ipRateLimit({ windowMs: 15 * 60_000, max: 8, code: 'reset_rate_limited', message: 'Too many reset requests from this network. Try again later.' }), wrap(async (req, res) => res.json(await services.auth.requestPasswordReset(req.body))));
  r.post('/api/auth/password-reset/complete', ipRateLimit({ windowMs: 15 * 60_000, max: 12 }), wrap(async (req, res) => res.json(await services.auth.completePasswordReset(req.body))));
  r.post('/internal/provider-callbacks/:notificationId', requireSecret('x-callback-secret', config.providerCallbackSecret),
    wrap(async (req, res) => res.json(await services.delivery.applyProviderCallback(req.params.notificationId, req.body && req.body.status))));
  return r;
};
