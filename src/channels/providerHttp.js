'use strict';
const { PermanentDeliveryError } = require('../domain/errors');

const isTransientStatus = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

async function readProviderJson(response, provider) {
  let data = null;
  try { data = await response.json(); } catch { /* provider returned no JSON */ }
  const providerFailed = data && data.ok === false;
  if (!response.ok || providerFailed) {
    const status = providerFailed ? (data?.error_code || response.status || 502) : (response.status || 502);
    const message = `${provider} rejected the message (HTTP ${status})`;
    if (isTransientStatus(status)) throw new Error(message);
    throw new PermanentDeliveryError(message);
  }
  return data;
}

async function providerFetch(url, options, provider) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(15000) }); }
  catch (err) { throw new Error(`${provider} request failed (${err?.name || 'network error'})`); }
  return readProviderJson(response, provider);
}

module.exports = { isTransientStatus, readProviderJson, providerFetch };
