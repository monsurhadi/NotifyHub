'use strict';
const express = require('express');
const { wrap, authenticate } = require('../middleware/auth');
const { badRequest } = require('../domain/errors');

/** Tenant API: usable with a dashboard token or an API key. Every call is scoped to the credential's tenant. */
module.exports = ({ services, repos }) => {
  const r = express.Router();
  r.use(authenticate(services.auth, 'any'));
  const tid = (req) => req.auth.tenantId;

  // Templates (FR-04, FR-05)
  r.get('/templates', wrap(async (req, res) => res.json({ templates: await services.templates.list(tid(req), { includeArchived: req.query.includeArchived === 'true' }) })));
  r.post('/templates', wrap(async (req, res) => res.status(201).json(await services.templates.create(tid(req), req.body))));
  r.get('/templates/:id', wrap(async (req, res) => res.json(await services.templates.get(tid(req), req.params.id))));
  r.put('/templates/:id', wrap(async (req, res) => res.json(await services.templates.update(tid(req), req.params.id, req.body))));
  r.post('/templates/:id/archive', wrap(async (req, res) => res.json(await services.templates.archive(tid(req), req.params.id))));
  r.get('/templates/:id/versions', wrap(async (req, res) => res.json({ versions: await services.templates.versions(tid(req), req.params.id) })));

  // Notifications (FR-06, FR-07, FR-11)
  r.post('/notifications', wrap(async (req, res) => {
    const key = req.get('idempotency-key');
    if (key !== undefined && (key.length < 1 || key.length > 128)) throw badRequest('Idempotency-Key must be 1 to 128 characters');
    const result = await services.notifications.create(tid(req), req.body, { idempotencyKey: key });
    res.status(result.duplicate ? 200 : 202).json(result);
  }));
  r.post('/notifications/bulk', wrap(async (req, res) => res.status(202).json(await services.notifications.createBulk(tid(req), req.body))));
  r.get('/notifications', wrap(async (req, res) => res.json({ notifications: await services.notifications.list(tid(req), req.query) })));
  r.get('/notifications/:id', wrap(async (req, res) => res.json(await services.notifications.get(tid(req), req.params.id))));

  // In-app inbox
  r.get('/inbox/:userRef', wrap(async (req, res) => res.json({ messages: await repos.inApp.list(tid(req), req.params.userRef) })));

  // Analytics (FR-13, FR-14)
  r.get('/analytics/summary', wrap(async (req, res) => res.json(await services.analytics.summary(tid(req), req.query))));
  r.get('/analytics/export.csv', wrap(async (req, res) => {
    const csv = await services.analytics.exportCsv(tid(req), req.query);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="notifications.csv"' }).send(csv);
  }));

  // Plan & usage (FR-15)
  r.get('/usage', wrap(async (req, res) => res.json(await services.billing.overview(tid(req)))));
  return r;
};
