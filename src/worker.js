'use strict';
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { createContainer } = require('./container');

/** Stand-alone worker process: `npm run worker` (use together with EMBEDDED_WORKER=false on the API). */
async function main() {
  const container = await createContainer();
  const worker = container.createWorker();
  worker.start();
  const shutdown = async (signal) => {
    container.logger.info('shutting down', { signal });
    await worker.stop();
    await container.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((err) => { console.error('Failed to start worker:', err); process.exit(1); });
