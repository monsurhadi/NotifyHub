'use strict';
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env'); // Node 20.12+, no dotenv package needed

const { createContainer } = require('./container');
const { createApp } = require('./app');

async function main() {
  const container = await createContainer();
  const { config, logger } = container;
  const app = createApp(container);
  const server = app.listen(config.port, () => {
    logger.info('NotifyHub API listening', { port: config.port, url: `http://localhost:${config.port}`, database: container.db.dialect, embeddedWorker: config.embeddedWorker });
  });

  let worker = null;
  if (config.embeddedWorker) { worker = container.createWorker(); worker.start(); }

  const shutdown = async (signal) => {
    logger.info('shutting down', { signal });
    server.close();
    if (worker) await worker.stop();
    await container.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((err) => { console.error('Failed to start:', err); process.exit(1); });
