'use strict';
const { badRequest } = require('./errors');
const { CHANNELS } = require('./constants');
const dns = require('node:dns').promises;
const net = require('node:net');
const { Agent } = require('undici');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[1-9]\d{6,14}$/;
const INAPP_REF = /^[A-Za-z0-9_.:@-]{1,128}$/;
const TELEGRAM_CHAT = /^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isHttpUrl(value, { allowHttp = true } = {}) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || (allowHttp && u.protocol === 'http:');
  } catch {
    return false;
  }
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (net.isIPv4(h)) {
    const [a, b, c] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && c <= 2) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIPv6(h)) {
    if (h.startsWith('::ffff:')) return isPrivateHost(h.slice(7));
    const first = parseInt(h.split(':')[0] || '0', 16);
    return first === 0 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00
      || (first & 0xe000) !== 0x2000 || h.startsWith('2001:db8:') || h.startsWith('2001:10:');
  }
  return false;
}

/** Reject hostnames that resolve to any non-public address to reduce DNS-based SSRF. */
async function assertPublicTarget(url, allowPrivate) {
  const parsed = new URL(url);
  if (allowPrivate) return;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHost(host)) throw badRequest('url points to a private address', { field: 'url' }, 'invalid_webhook_url');
  if (!net.isIP(host)) {
    let addresses;
    try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
    catch { throw badRequest('url hostname could not be resolved', { field: 'url' }, 'invalid_webhook_url'); }
    if (!addresses.length || addresses.some((entry) => isPrivateHost(entry.address))) {
      throw badRequest('url resolves to a private address', { field: 'url' }, 'invalid_webhook_url');
    }
  }
}

/** Resolve once, validate every answer, and pin the HTTP connection to those checked IPs. */
async function fetchPublicTarget(url, options, allowPrivate) {
  const parsed = new URL(url);
  let addresses = [];
  if (!allowPrivate) {
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isPrivateHost(host)) throw badRequest('url points to a private address', { field: 'url' }, 'invalid_webhook_url');
    if (!net.isIP(host)) {
      try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
      catch { throw badRequest('url hostname could not be resolved', { field: 'url' }, 'invalid_webhook_url'); }
      if (!addresses.length || addresses.some((entry) => isPrivateHost(entry.address))) {
        throw badRequest('url resolves to a private address', { field: 'url' }, 'invalid_webhook_url');
      }
    }
  }
  const dispatcher = addresses.length ? new Agent({ connect: { lookup(host, lookupOptions, callback) {
    const matching = lookupOptions.family ? addresses.filter((entry) => entry.family === lookupOptions.family) : addresses;
    if (!matching.length) return callback(new Error('No validated address for webhook host'));
    if (lookupOptions.all) return callback(null, matching);
    return callback(null, matching[0].address, matching[0].family);
  } } }) : null;
  try {
    const response = await fetch(url, { ...options, redirect: 'manual', ...(dispatcher ? { dispatcher } : {}) });
    await response.arrayBuffer().catch(() => {});
    return { status: response.status };
  } finally {
    if (dispatcher) await dispatcher.close();
  }
}

/** Returns an error message, or null when the recipient is valid for the channel. */
function recipientProblem(channel, recipient, config) {
  if (typeof recipient !== 'string' || recipient.trim() === '') return 'recipient is required';
  switch (channel) {
    case 'email': return EMAIL.test(recipient) && recipient.length <= 254 ? null : 'recipient is not a valid email address';
    case 'sms': return PHONE.test(recipient) ? null : 'recipient is not a valid phone number (use international format, e.g. +8801712345678)';
    case 'whatsapp': return PHONE.test(recipient) ? null : 'recipient is not a valid phone number (use international format, e.g. +8801712345678)';
    case 'telegram': return TELEGRAM_CHAT.test(recipient) ? null : 'recipient must be a Telegram numeric chat id or public channel username';
    case 'webhook': {
      if (!isHttpUrl(recipient, { allowHttp: config.env !== 'production' })) return 'recipient is not a valid webhook URL';
      if (!config.allowPrivateWebhookTargets && isPrivateHost(new URL(recipient).hostname)) return 'webhook URL points to a private address';
      return null;
    }
    case 'in-app': return INAPP_REF.test(recipient) ? null : 'recipient is not a valid in-app user reference';
    default: return 'unsupported channel';
  }
}

function requireString(obj, field, { max = 10000, min = 1 } = {}) {
  const v = obj[field];
  if (typeof v !== 'string' || v.trim().length < min) throw badRequest(`${field} is required`, { field });
  if (v.length > max) throw badRequest(`${field} is too long (max ${max} characters)`, { field });
  return v;
}

module.exports = { CHANNELS, isPlainObject, isHttpUrl, isPrivateHost, assertPublicTarget, fetchPublicTarget, recipientProblem, requireString };
