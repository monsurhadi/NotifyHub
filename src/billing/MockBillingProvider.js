'use strict';

/**
 * Built-in simulator that behaves like Stripe's test mode (FR-16), used when STRIPE_SECRET_KEY is not set.
 *   4242 4242 4242 4242  -> payment succeeds
 *   4000 0000 0000 0002  -> card declined
 */
class MockBillingProvider {
  constructor() { this.mode = 'mock'; }
  async createCheckout({ sessionId }) { return { providerRef: `mock_${sessionId}`, url: null }; }
  async settle(session, input = {}) {
    const card = String(input.cardNumber || '').replace(/[\s-]/g, '');
    if (card === '4242424242424242') return { status: 'paid' };
    if (card === '4000000000000002') return { status: 'declined', message: 'Your card was declined (test card).' };
    return { status: 'invalid', message: 'Unknown test card. Use 4242 4242 4242 4242 (success) or 4000 0000 0000 0002 (declined).' };
  }
}
module.exports = { MockBillingProvider };
