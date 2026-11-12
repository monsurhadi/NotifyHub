'use strict';

/** Masks a recipient for exports and logs (FR-14): a***@example.com, +880****5678 ... */
function maskRecipient(value) {
  const v = String(value ?? '');
  if (!v) return '';
  if (v.includes('@')) {
    const at = v.lastIndexOf('@');
    return `${v.slice(0, 1)}***@${v.slice(at + 1)}`;
  }
  if (/^\+?\d{7,15}$/.test(v)) return `${v.slice(0, 4)}${'*'.repeat(Math.max(v.length - 6, 3))}${v.slice(-2)}`;
  if (/^https?:\/\//i.test(v)) {
    try { const u = new URL(v); return `${u.protocol}//${u.host}/***`; } catch { /* fall through */ }
  }
  return `${v.slice(0, 1)}***`;
}
module.exports = { maskRecipient };
