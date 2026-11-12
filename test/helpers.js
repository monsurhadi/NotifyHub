'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createContainer } = require('../src/container');
const { createApp } = require('../src/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Optional: run the same tests against PostgreSQL.  TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres npm test
 * Every test file gets its own freshly created database, dropped again at the end.
 */
async function createTestPostgres() {
  const { Client } = require('pg');
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const name = `nh_test_${crypto.randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}
async function dropTestPostgres(name) {
  const { Client } = require('pg');
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}

/** Starts the whole app (API + a worker you drive by hand) on a temp SQLite file and a random port. */
async function startApp(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notifyhub-test-'));
  const pg = process.env.TEST_DATABASE_URL ? await createTestPostgres() : null;
  const container = await createContainer({
    sqlitePath: path.join(dir, 'test.db'), ...(pg ? { databaseUrl: pg.url } : {}), logLevel: 'silent',
    retryBaseMs: 20, retryMaxMs: 200, webhookRetryBaseMs: 20, rateConfigCacheMs: 0, defaultRatePerMinute: 100000,
    loginLockSeconds: 1, jobLockTimeoutMs: 60000, ...overrides,
  });
  const app = createApp(container);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const worker = container.createWorker('test-worker');
  let counter = 0;

  async function api(method, url, { token, key, body, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    const cred = token || key;
    if (cred) h.authorization = `Bearer ${cred}`;
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* not json (csv) */ }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  /** Creates a fresh tenant with a dashboard token and an API key. */
  async function newTenant(label = 'Tenant') {
    counter += 1;
    const email = `${label.toLowerCase()}${counter}@example.test`;
    const reg = await api('POST', '/api/register', { body: { companyName: `${label} Company ${counter}`, email, password: 'password123' } });
    if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
    let verificationToken = reg.body.tenant.verificationToken;
    if (!verificationToken) {
      const verificationMail = await waitFor(() => container.db.get('SELECT body FROM outbox WHERE recipient = ? AND subject = ?', [email, 'Verify your NotifyHub email']));
      verificationToken = /[?&]verify=([a-f0-9]{64})/.exec(verificationMail.body)?.[1];
    }
    if (!verificationToken) throw new Error('verification email did not contain a usable local verification link');
    const verified = await api('POST', '/api/auth/verify-email', { body: { token: verificationToken } });
    if (verified.status !== 200) throw new Error(`email verification failed: ${JSON.stringify(verified.body)}`);
    const login = await api('POST', '/api/auth/login', { body: { email, password: 'password123' } });
    const token = login.body.token;
    const keyRes = await api('POST', '/api/keys', { token, body: { name: 'test key' } });
    const t = { label, email, token, key: keyRes.body.key, tenantId: login.body.tenant.id };
    t.template = async (channel = 'email', over = {}) => {
      counter += 1;
      const body = { name: `tpl-${counter}`, channel, subject: channel === 'email' ? 'Hello {{name}}' : undefined, body: channel === 'email' ? '<p>Hi {{name}}</p>' : 'Hi {{name}}', ...over };
      const r = await api('POST', '/v1/templates', { key: t.key, body });
      if (r.status !== 201) throw new Error(`template failed: ${JSON.stringify(r.body)}`);
      return r.body;
    };
    t.send = (body, headers) => api('POST', '/v1/notifications', { key: t.key, body, headers });
    t.get = (id) => api('GET', `/v1/notifications/${id}`, { key: t.key });
    return t;
  }

  async function stop() {
    await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    await container.close();
    if (pg) await dropTestPostgres(pg.name);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { container, base, api, newTenant, worker, drain: (ms) => worker.drain(ms), stop };
}

/** A tiny HTTP server that records what it receives; `respond(req, n)` decides the answer. */
async function startReceiver(respond = () => ({ status: 200 })) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rec = { method: req.method, headers: req.headers, raw: Buffer.concat(chunks).toString() };
      try { rec.json = JSON.parse(rec.raw); } catch { rec.json = null; }
      requests.push(rec);
      const answer = respond(rec, requests.length);
      if (answer.hang) return; // never answer (timeout tests)
      res.writeHead(answer.status || 200).end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/hook`, requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

async function waitFor(fn, timeoutMs = 3000, stepMs = 25) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(stepMs);
  }
}

module.exports = { startApp, startReceiver, waitFor, sleep };
