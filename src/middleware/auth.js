'use strict';
const { unauthorized, forbidden } = require('../domain/errors');
const { safeEqual } = require('../util/crypto');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Credentials come from "Authorization: Bearer <JWT or API key>" or "X-API-Key".
 * The tenant is ALWAYS taken from the verified credential, never from the request body or headers (NFR-04).
 * mode "any"  -> dashboard JWT or API key
 * mode "jwt"  -> dashboard JWT only (admin actions)
 */
function authenticate(authService, mode = 'any') {
  return wrap(async (req, res, next) => {
    const header = req.get('authorization') || '';
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : req.get('x-api-key');
    if (!raw) throw unauthorized('Missing credentials. Send "Authorization: Bearer <token or API key>".');
    if (raw.startsWith('nh_')) {
      if (mode === 'jwt') throw forbidden('This action needs a dashboard login token, an API key is not enough', 'login_required');
      req.auth = await authService.authenticateApiKey(raw);
    } else {
      req.auth = await authService.authenticateJwt(raw);
    }
    next();
  });
}

/** Static shared-secret guard for operator endpoints. */
function requireSecret(headerName, expected) {
  return (req, res, next) => {
    const given = req.get(headerName);
    if (!given || !safeEqual(given, expected)) return next(unauthorized(`Missing or invalid ${headerName} header`, 'invalid_secret'));
    return next();
  };
}

module.exports = { wrap, authenticate, requireSecret };
