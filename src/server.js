import { createApp } from './app.js';
import { config } from './config.js';
import { createDatabase } from './db.js';

const db = createDatabase(config);
const app = createApp({ config, db });
const server = app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}.`);
});

async function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

