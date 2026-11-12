'use strict';
const { newId } = require('../util/crypto');
const { badRequest, notFound, conflict, AppError } = require('../domain/errors');

const period = () => new Date().toISOString().slice(0, 7);
const nextReset = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };

/** FR-15 plan & usage, FR-16 upgrade through a (test-mode) checkout. */
class BillingService {
  constructor({ config, tenants, usage, billing, provider }) { Object.assign(this, { config, tenants, usage, billing, provider }); }

  async overview(tenantId) {
    const tenant = await this.tenants.findById(tenantId);
    const plan = this.config.plans[tenant.plan] || this.config.plans.free;
    const used = await this.usage.get(tenantId, period());
    return {
      plan: tenant.plan, planName: plan.name, limit: plan.monthlyLimit, used, remaining: Math.max(0, plan.monthlyLimit - used),
      period: period(), resetsOn: nextReset(), billingMode: this.provider.mode,
      plans: { free: this.config.plans.free.monthlyLimit, pro: this.config.plans.pro.monthlyLimit },
      events: (await this.billing.listEvents(tenantId)).map((e) => ({ type: e.type, detail: e.detail, at: e.created_at })),
    };
  }

  _event(tenantId, type, detail) { return this.billing.addEvent({ id: newId(), tenantId, type, detail, createdAt: new Date().toISOString() }); }

  async startCheckout(tenantId) {
    const tenant = await this.tenants.findById(tenantId);
    if (tenant.plan === 'pro') throw conflict('You are already on the Pro plan. No charge was made.', 'already_pro');
    const id = newId();
    const created = await this.provider.createCheckout({ sessionId: id, plan: 'pro', tenant });
    await this.billing.createSession({ id, tenantId, plan: 'pro', providerRef: created.providerRef, createdAt: new Date().toISOString() });
    await this._event(tenantId, 'checkout_started', 'Pro plan');
    return { sessionId: id, mode: this.provider.mode, url: created.url };
  }

  async _session(tenantId, id) {
    const s = await this.billing.findSession(tenantId, id);
    if (!s) throw notFound('Checkout session not found', 'checkout_not_found');
    if (s.status !== 'open') throw conflict(`This checkout is already ${s.status}`, 'checkout_closed');
    return s;
  }

  async _complete(tenantId, session) {
    if (!(await this.billing.closeSession(tenantId, session.id, 'paid', new Date().toISOString()))) throw conflict('This checkout is already closed', 'checkout_closed');
    await this.tenants.setPlan(tenantId, session.plan);
    await this._event(tenantId, 'payment_succeeded', `Upgraded to ${session.plan}`);
    return this.overview(tenantId);
  }

  /** Simulator only: submit a test card. Declined cards keep the session open so another card can be tried. */
  async pay(tenantId, sessionId, input) {
    if (this.provider.mode !== 'mock') throw badRequest('Complete the payment on the Stripe checkout page', undefined, 'use_stripe_checkout');
    const session = await this._session(tenantId, sessionId);
    const result = await this.provider.settle(session, input || {});
    if (result.status === 'paid') return this._complete(tenantId, session);
    await this._event(tenantId, 'payment_failed', result.message);
    throw new AppError(402, result.status === 'declined' ? 'card_declined' : 'card_invalid', result.message);
  }

  /** Stripe mode: called after the user returns from Stripe to check the payment. */
  async confirm(tenantId, sessionId) {
    const session = await this._session(tenantId, sessionId);
    const result = await this.provider.settle(session);
    if (result.status === 'paid') return this._complete(tenantId, session);
    return { pending: true, message: result.message };
  }

  async cancel(tenantId, sessionId) {
    const session = await this._session(tenantId, sessionId);
    await this.billing.closeSession(tenantId, session.id, 'cancelled', new Date().toISOString());
    await this._event(tenantId, 'checkout_cancelled', 'No charge made');
    return this.overview(tenantId);
  }
}
module.exports = { BillingService };
