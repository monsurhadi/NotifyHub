'use strict';

/**
 * Real Stripe Checkout in TEST mode (needs STRIPE_SECRET_KEY=sk_test_...). No SDK: plain REST calls.
 * The user is redirected to Stripe, then comes back to /?checkout=success&session=<id>, which calls confirm.
 */
class StripeBillingProvider {
  constructor(config) { this.mode = 'stripe'; this.config = config; }

  async _call(method, path, form) {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${this.config.stripeSecretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Stripe error: ${(json.error && json.error.message) || res.status}`);
    return json;
  }

  async createCheckout({ sessionId }) {
    const base = this.config.publicBaseUrl;
    const s = await this._call('POST', '/checkout/sessions', {
      mode: 'payment', client_reference_id: sessionId,
      success_url: `${base}/?checkout=success&session=${sessionId}`,
      cancel_url: `${base}/?checkout=cancel&session=${sessionId}`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '900',
      'line_items[0][price_data][product_data][name]': 'NotifyHub Pro plan (test mode)',
    });
    return { providerRef: s.id, url: s.url };
  }

  async settle(session) {
    const s = await this._call('GET', `/checkout/sessions/${encodeURIComponent(session.provider_ref)}`);
    return s.payment_status === 'paid' ? { status: 'paid' } : { status: 'pending', message: 'Payment not completed yet' };
  }
}
module.exports = { StripeBillingProvider };
