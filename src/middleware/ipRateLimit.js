'use strict';

/** Small bounded, process-local emergency throttle for unauthenticated and API traffic. */
function ipRateLimit({ windowMs, max, code = 'ip_rate_limited', message = 'Too many requests. Try again shortly.' }) {
  const buckets = new Map();
  let operations = 0;
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count++;
    buckets.set(key, bucket);
    if (++operations % 256 === 0) {
      for (const [ip, value] of buckets) if (value.resetAt <= now) buckets.delete(ip);
      if (buckets.size > 10000) {
        const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, buckets.size - 10000);
        for (const [ip] of oldest) buckets.delete(ip);
      }
    }
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: { code, message, details: { retryAfterSeconds: retry } } });
    }
    next();
  };
}

module.exports = { ipRateLimit };
