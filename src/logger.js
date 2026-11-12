'use strict';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** Structured (JSON-lines) logger, NFR-09. */
function createLogger(config) {
  const threshold = LEVELS[config.logLevel] ?? LEVELS.info;
  const emit = (level, msg, fields) => {
    if (LEVELS[level] < threshold) return;
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
module.exports = { createLogger };
