'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const newId = () => crypto.randomUUID();
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Passwords: scrypt with a random salt (never stored in plain text). */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  return safeEqual(derived.toString('hex'), hash);
}

/** Minimal HS256 JWT (no external dependency). */
const b64u = (v) => Buffer.from(v).toString('base64url');
function signJwt(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }))}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}
function verifyJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!safeEqual(expected, parts[2])) return null;
  try {
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

module.exports = { newId, randomHex, sha256, hmacHex, safeEqual, hashPassword, verifyPassword, signJwt, verifyJwt };
