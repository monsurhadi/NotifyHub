'use strict';
const { badRequest } = require('./errors');

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Placeholder names used in a text, in order of first appearance. */
function extractPlaceholders(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(PLACEHOLDER)) if (!found.includes(m[1])) found.push(m[1]);
  return found;
}

/** Rejects stray "{{" or "}}" (e.g. "Hello {{name"). */
function assertSyntax(text, field) {
  const leftover = String(text ?? '').replace(PLACEHOLDER, '');
  if (leftover.includes('{{') || leftover.includes('}}')) {
    throw badRequest(`Invalid placeholder syntax in ${field}. Use {{name}} with letters, digits or underscores.`, { field }, 'invalid_template_syntax');
  }
}

const stringify = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Fills placeholders. Values are HTML-escaped when `escape` is true (email body, in-app). */
function render(text, payload, { escape = false } = {}) {
  return String(text ?? '').replace(PLACEHOLDER, (_, key) => {
    const value = stringify(payload[key]);
    return escape ? escapeHtml(value) : value;
  });
}

function missingKeys(placeholders, payload) {
  return placeholders.filter((k) => payload[k] === undefined || payload[k] === null);
}

module.exports = { extractPlaceholders, assertSyntax, render, missingKeys, escapeHtml };
