'use strict';
/**
 * End-to-end walk-through against a running NotifyHub:  npm start   (one terminal)   npm run demo   (another)
 * Registers a workspace, creates an API key and a template, sends notifications (including a flaky provider to show
 * retries), receives signed webhooks on a local port, sends a bulk batch and prints the analytics.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const RECEIVER_PORT = Number(process.env.DEMO_RECEIVER_PORT || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (n, title) => console.log(`\n[${n}] ${title}`);
const show = (label, value) => console.log(`    ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text; try { data = JSON.parse(text); } catch { /* csv or plain text */ }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function waitForStatus(id, key, wanted, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    const n = await call('GET', `/v1/notifications/${id}`, { token: key });
    if (n.status !== last) { last = n.status; show('status', `${n.status} (attempts: ${n.attempts})`); }
    if (wanted.includes(n.status)) return n;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${wanted.join('/')}. Is a worker running? (npm start runs one automatically)`);
}

async function main() {
  console.log(`NotifyHub demo against ${BASE}`);
  const health = await call('GET', '/health').catch(() => { throw new Error(`Cannot reach ${BASE}. Start the server first with: npm start`); });
  show('health', health);

  // local webhook receiver that verifies the signature
  const events = [];
  let secret = '';
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
      const ok = req.headers['x-notifyhub-signature'] === expected;
      const evt = JSON.parse(raw);
      events.push({ status: evt.data.status, signatureValid: ok });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((r) => receiver.listen(RECEIVER_PORT, r));

  step(1, 'Register a workspace and sign in');
  const email = `demo+${Date.now()}@example.com`;
  const registration = await call('POST', '/api/register', { body: { companyName: `Demo Company ${Date.now()}`, email, password: 'demo-password-1' } });
  let verificationToken = registration.tenant.verificationToken;
  if (!verificationToken) verificationToken = (await call('POST', '/api/auth/verification', { body: { email } })).verificationToken;
  if (!verificationToken) throw new Error('Demo needs the local development verification link to continue.');
  await call('POST', '/api/auth/verify-email', { body: { token: verificationToken } });
  show('email verification', 'verified; sign-in enabled');
  const login = await call('POST', '/api/auth/login', { body: { email, password: 'demo-password-1' } });
  const jwt = login.token;
  show('workspace', login.tenant);

  step(2, 'Create an API key (shown only once)');
  const key = (await call('POST', '/api/keys', { token: jwt, body: { name: 'demo key' } })).key;
  show('api key', key);

  step(3, 'Register a webhook endpoint for status events');
  const hooks = await call('POST', '/api/webhooks', { token: jwt, body: { url: `http://localhost:${RECEIVER_PORT}/hook` } });
  secret = (await call('GET', '/api/webhooks', { token: jwt })).signingSecret;
  show('endpoint', hooks.url);

  step(4, 'Create an email template with placeholders');
  const tpl = await call('POST', '/v1/templates', { token: key, body: { name: `welcome-${Date.now()}`, channel: 'email', subject: 'Welcome, {{name}}!', body: '<p>Hi {{name}}, your code is <b>{{code}}</b>.</p>' } });
  show('template', { id: tpl.id, placeholders: tpl.placeholders, version: tpl.version });

  step(5, 'Send one email (API answers immediately, the worker delivers in the background)');
  const sent = await call('POST', '/v1/notifications', { token: key, body: { channel: 'email', recipient: 'asha@example.com', template_id: tpl.id, payload: { name: 'Asha', code: '482910' } } });
  show('accepted', sent);
  await waitForStatus(sent.id, key, ['delivered', 'sent', 'failed']);

  step(6, 'Send to flaky@example.com: the provider fails twice, NotifyHub retries with exponential backoff');
  const flaky = await call('POST', '/v1/notifications', { token: key, body: { channel: 'email', recipient: 'flaky@example.com', template_id: tpl.id, payload: { name: 'Flaky', code: '1' } } });
  const done = await waitForStatus(flaky.id, key, ['delivered', 'sent', 'failed']);
  show('delivery attempts', done.deliveryAttempts.map((a) => `#${a.attempt} ${a.status}${a.error ? ` (${a.error})` : ''}`).join(' | '));

  step(7, 'Bulk send to 3 recipients (one address is invalid and is rejected on its own)');
  const bulk = await call('POST', '/v1/notifications/bulk', { token: key, body: { channel: 'email', template_id: tpl.id, payload: { name: 'Friend', code: '7' }, recipients: ['one@example.com', 'not-an-email', 'three@example.com'] } });
  show('result', { accepted: bulk.accepted, rejected: bulk.rejected });
  for (const r of bulk.results.filter((x) => x.notificationId)) await waitForStatus(r.notificationId, key, ['delivered', 'sent', 'failed'], 30000);

  step(8, 'Analytics for today');
  const summary = await call('GET', '/v1/analytics/summary', { token: key });
  show('totals', summary.totals);
  show('by channel (email)', summary.byChannel.email);

  step(9, 'Plan and usage');
  const usage = await call('GET', '/v1/usage', { token: key });
  show('plan', `${usage.planName}: ${usage.used} of ${usage.limit} used this month`);

  await sleep(800);
  step(10, 'Signed webhook events received locally');
  show('events', events.map((e) => `${e.status}${e.signatureValid ? '' : ' (BAD SIGNATURE)'}`).join(', '));
  console.log(`\nAll ${events.every((e) => e.signatureValid) ? 'signatures valid.' : 'signatures NOT valid!'}`);
  console.log(`\nOpen ${BASE}/ in a browser and sign in as ${email} / demo-password-1 to see everything in the dashboard.`);
  receiver.close();
}
main().catch((err) => { console.error(`\nDemo failed: ${err.message}`); process.exit(1); });
