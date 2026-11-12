'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { ipRateLimit } = require('../src/middleware/ipRateLimit');
const { isPrivateHost, assertPublicTarget, fetchPublicTarget } = require('../src/domain/validators');

test('per-IP limiter allows the configured burst and returns a retry hint when exceeded', () => {
  const limit = ipRateLimit({ windowMs: 60_000, max: 2 });
  const call = () => {
    const headers = {}; let status; let body; let continued = false;
    const res = { set: (key, value) => { headers[key] = value; return res; }, status: (value) => { status = value; return res; }, json: (value) => { body = value; return res; } };
    limit({ ip: '198.51.100.44' }, res, () => { continued = true; });
    return { headers, status, body, continued };
  };
  assert.equal(call().continued, true);
  assert.equal(call().continued, true);
  const blocked = call();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['Retry-After'] > 0, true);
  assert.equal(blocked.body.error.code, 'ip_rate_limited');
});

test('private and special-use IP ranges are classified as non-public targets', async () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.18.0.2', '192.168.1.5', '169.254.1.1', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:192.168.0.1']) {
    assert.equal(isPrivateHost(address), true, address);
  }
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPrivateHost(address), false, address);
  await assert.rejects(assertPublicTarget('http://127.0.0.1/hook', false), { code: 'invalid_webhook_url' });
});

test('webhook requests do not follow redirects', async (t) => {
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/capture' }); res.end(); }
    else { redirected = true; res.end('captured'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const { port } = server.address();
  const result = await fetchPublicTarget(`http://127.0.0.1:${port}/redirect`, { method: 'POST', body: '{}' }, true);
  assert.equal(result.status, 302);
  assert.equal(redirected, false);
});
