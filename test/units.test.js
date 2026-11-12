'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractPlaceholders, assertSyntax, render, missingKeys } = require('../src/domain/templateEngine');
const { recipientProblem } = require('../src/domain/validators');
const { maskRecipient } = require('../src/util/mask');
const { ChannelFactory } = require('../src/channels/ChannelFactory');
const { NotificationChannel } = require('../src/channels/NotificationChannel');
const { signJwt, verifyJwt, hashPassword, verifyPassword } = require('../src/util/crypto');

describe('template engine', () => {
  it('extracts, validates and renders placeholders', () => {
    assert.deepEqual(extractPlaceholders('Hi {{name}}, {{ code }} and {{name}} again'), ['name', 'code']);
    assert.throws(() => assertSyntax('Hello {{name', 'body'), /Invalid placeholder syntax/);
    assert.throws(() => assertSyntax('Hello name}}', 'body'));
    assert.doesNotThrow(() => assertSyntax('Hello {{name}}', 'body'));
    assert.equal(render('Hi {{name}}', { name: 'Asha' }), 'Hi Asha');
    assert.equal(render('Hi {{name}}', { name: '<b>' }, { escape: true }), 'Hi &lt;b&gt;');
    assert.equal(render('Hi {{name}}', { name: 'বাংলা 😀' }), 'Hi বাংলা 😀');
    assert.deepEqual(missingKeys(['a', 'b'], { a: 1, b: null }), ['b']);
  });
});

describe('recipient validation per channel', () => {
  const cfg = { env: 'development', allowPrivateWebhookTargets: true };
  it('accepts valid and rejects invalid recipients', () => {
    assert.equal(recipientProblem('email', 'user@example.com', cfg), null);
    assert.ok(recipientProblem('email', 'user@@example', cfg));
    assert.equal(recipientProblem('sms', '+8801712345678', cfg), null);
    assert.ok(recipientProblem('sms', 'not-a-number', cfg));
    assert.equal(recipientProblem('webhook', 'https://client.example.com/hook', cfg), null);
    assert.ok(recipientProblem('webhook', 'htp:/x', cfg));
    assert.ok(recipientProblem('webhook', 'http://localhost/x', { env: 'production', allowPrivateWebhookTargets: false }));
    assert.equal(recipientProblem('in-app', 'u-102', cfg), null);
    assert.ok(recipientProblem('in-app', 'bad user!', cfg));
  });
});

describe('masking', () => {
  it('hides most of the recipient', () => {
    assert.equal(maskRecipient('asha@example.com'), 'a***@example.com');
    assert.equal(maskRecipient('+8801712345678'), '+880********78');
    assert.equal(maskRecipient('https://client.example.com/hook?token=secret'), 'https://client.example.com/***');
    assert.equal(maskRecipient('user-102'), 'u***');
  });
});

describe('channel factory (Open/Closed)', () => {
  it('a new channel can be added without touching existing code', async () => {
    class PigeonChannel extends NotificationChannel { constructor() { super('pigeon'); } async send() { return { providerMessageId: 'coo', confirmed: true }; } }
    const factory = new ChannelFactory();
    assert.equal(factory.supports('pigeon'), false);
    assert.throws(() => factory.create('pigeon'), /Unsupported channel/);
    factory.register('pigeon', () => new PigeonChannel());
    assert.equal(factory.supports('pigeon'), true);
    assert.equal(factory.create('pigeon'), factory.create('pigeon'));
    assert.equal((await factory.create('pigeon').send({})).providerMessageId, 'coo');
  });
});

describe('crypto helpers', () => {
  it('JWTs verify, expire and reject tampering; passwords are salted', async () => {
    const token = signJwt({ sub: 'u1' }, 'secret', 60);
    assert.equal(verifyJwt(token, 'secret').sub, 'u1');
    assert.equal(verifyJwt(token, 'other-secret'), null);
    assert.equal(verifyJwt(`${token}x`, 'secret'), null);
    assert.equal(verifyJwt(signJwt({ sub: 'u1' }, 'secret', -10), 'secret'), null);
    const h1 = await hashPassword('password123');
    const h2 = await hashPassword('password123');
    assert.notEqual(h1, h2);
    assert.ok(await verifyPassword('password123', h1));
    assert.ok(!(await verifyPassword('wrong', h1)));
  });
});
