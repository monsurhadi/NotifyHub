'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SmsChannel } = require('../src/channels/SmsChannel');
const { WhatsAppChannel } = require('../src/channels/WhatsAppChannel');
const { TelegramChannel } = require('../src/channels/TelegramChannel');
const { RetryDecorator } = require('../src/decorators/RetryDecorator');
const { PermanentDeliveryError } = require('../src/domain/errors');
const { recipientProblem } = require('../src/domain/validators');
const { startApp } = require('./helpers');

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

describe('real messaging provider adapters', () => {
  it('sends SMS through the Twilio Messages API with E.164 recipient and Basic auth', async () => {
    let request;
    const restore = mockFetch(async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 });
    });
    try {
      const channel = new SmsChannel({
        config: { sms: { provider: 'twilio', accountSid: 'AC123', authToken: 'token', from: '+15550001111', messagingServiceSid: '' } },
        simulatedProvider: { deliver: async () => { throw new Error('simulator should not run'); } },
      });
      const sent = await channel.send({ recipient: '+8801944713903', body: 'SMS test', notificationId: 'n1' });
      assert.equal(sent.providerMessageId, 'SM123');
      assert.equal(sent.confirmed, false);
      assert.match(request.url, /api\.twilio\.com\/2010-04-01\/Accounts\/AC123\/Messages\.json$/);
      assert.equal(request.options.headers.authorization, `Basic ${Buffer.from('AC123:token').toString('base64')}`);
      const form = new URLSearchParams(request.options.body);
      assert.equal(form.get('To'), '+8801944713903');
      assert.equal(form.get('From'), '+15550001111');
      assert.equal(form.get('Body'), 'SMS test');
    } finally { restore(); }
  });

  it('sends WhatsApp text through Meta Cloud API and returns the provider message id', async () => {
    let request;
    const restore = mockFetch(async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 });
    });
    try {
      const channel = new WhatsAppChannel({ config: { whatsapp: { accessToken: 'secret', phoneNumberId: '12345', apiVersion: 'v23.0' } } });
      const sent = await channel.send({ recipient: '+8801944713903', body: 'WhatsApp test' });
      assert.equal(sent.providerMessageId, 'wamid.test');
      assert.equal(sent.confirmed, false);
      assert.equal(request.url, 'https://graph.facebook.com/v23.0/12345/messages');
      assert.equal(request.options.headers.authorization, 'Bearer secret');
      assert.deepEqual(JSON.parse(request.options.body), {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: '8801944713903', type: 'text',
        text: { preview_url: false, body: 'WhatsApp test' },
      });
    } finally { restore(); }
  });

  it('sends Telegram text to a Bot API chat id', async () => {
    let request;
    const restore = mockFetch(async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ok: true, result: { message_id: 27 } }), { status: 200 });
    });
    try {
      const channel = new TelegramChannel({ config: { telegram: { botToken: 'bot-secret' } } });
      const sent = await channel.send({ recipient: '123456789', body: 'Telegram test' });
      assert.equal(sent.providerMessageId, '27');
      assert.equal(sent.confirmed, false);
      assert.match(request.url, /api\.telegram\.org\/botbot-secret\/sendMessage$/);
      assert.deepEqual(JSON.parse(request.options.body), { chat_id: '123456789', text: 'Telegram test' });
    } finally { restore(); }
  });

  it('sanitizes permanent provider errors so response details and secrets are not stored as notification errors', async () => {
    const restore = mockFetch(async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: 'bad chat id' }), { status: 400 }));
    try {
      const channel = new TelegramChannel({ config: { telegram: { botToken: 'bot-secret' } } });
      await assert.rejects(channel.send({ recipient: '123', body: 'test' }), (err) => {
        assert.ok(err instanceof PermanentDeliveryError);
        assert.ok(!err.message.includes('bot-secret'));
        assert.ok(!err.message.includes('bad chat id'));
        return true;
      });
    } finally { restore(); }
  });

  it('does not retry permanent provider rejections and validates Telegram chat destinations', async () => {
    let calls = 0;
    const retry = new RetryDecorator({ send: async () => { calls++; throw new PermanentDeliveryError('provider rejected request'); } }, { maxAttempts: 5, baseMs: 10, maxMs: 50 });
    await assert.rejects(retry.send({ attempt: 1 }), PermanentDeliveryError);
    assert.equal(calls, 1);
    assert.equal(recipientProblem('telegram', '123456789', {}), null);
    assert.equal(recipientProblem('telegram', '@valid_channel', {}), null);
    assert.match(recipientProblem('telegram', 'not a chat id', {}), /chat id/);
    assert.equal(recipientProblem('whatsapp', '+8801944713903', {}), null);
  });

  it('routes SMS, WhatsApp and Telegram notifications through the configured providers end to end', async () => {
    const original = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      const target = String(url);
      if (!target.startsWith('https://api.twilio.com/') && !target.startsWith('https://graph.facebook.com/') && !target.startsWith('https://api.telegram.org/')) return original(url, options);
      requests.push({ url: target, options });
      if (target.startsWith('https://api.twilio.com/')) return new Response(JSON.stringify({ sid: 'SM_test' }), { status: 201 });
      if (target.startsWith('https://graph.facebook.com/')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 28 } }), { status: 200 });
    };
    let ctx;
    try {
      ctx = await startApp({
        sms: { provider: 'twilio', accountSid: 'AC_test', authToken: 'test-secret', from: '+15550001111', messagingServiceSid: '' },
        whatsapp: { accessToken: 'test-token', phoneNumberId: '12345', apiVersion: 'v23.0' },
        telegram: { botToken: 'bot-test-token' },
      });
      const t = await ctx.newTenant('Provider');
      const ids = [];
      for (const [channel, recipient] of [
        ['sms', '+8801944713903'], ['whatsapp', '+8801944713903'], ['telegram', '123456789'],
      ]) {
        const template = await t.template(channel);
        const sent = await t.send({ channel, recipient, template_id: template.id, payload: { name: 'Asha' } });
        assert.equal(sent.status, 202, channel);
        ids.push(sent.body.id);
      }
      await ctx.drain();
      for (const id of ids) assert.equal((await t.get(id)).body.status, 'sent');
      assert.equal(requests.length, 3);
      assert.ok(requests.some((r) => r.url.startsWith('https://api.twilio.com/')));
      assert.ok(requests.some((r) => r.url.startsWith('https://graph.facebook.com/')));
      assert.ok(requests.some((r) => r.url.startsWith('https://api.telegram.org/')));
    } finally {
      global.fetch = original;
      if (ctx) await ctx.stop();
    }
  });
});
