#!/usr/bin/env node
// Entry point for the gettoken-verify systemd service.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createService } from './service.mjs';
import { createApp } from './app.mjs';
import { createProviders } from './pay/index.mjs';
import { maintainBackups } from './backup.mjs';
import { assertAccessMigration } from './access.mjs';

const log = message => console.log(`[verify] ${message}`);
const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const store = openStore(join(config.dataDir, 'verify.db'));
assertAccessMigration(store);
const providers = createProviders(config);
const service = createService({ store, config, providers, log });
const server = createServer(createApp({ service, store, providers, config, log }));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    await service.tick();
    maintainBackups({ store, dataDir: config.dataDir });
  } catch (error) {
    log(`background work failed: ${error.stack || error.message}`);
  } finally {
    busy = false;
  }
}
const timer = setInterval(tick, 60_000);
tick();

server.listen(config.port, config.host, () => {
  log(`listening on ${config.host}:${config.port}, payment mode ${config.mode}, channels: ${Object.keys(providers).join(', ') || 'none'}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
