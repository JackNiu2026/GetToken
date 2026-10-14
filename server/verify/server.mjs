#!/usr/bin/env node
// Entry point for the gettoken-verify systemd service.
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createService } from './service.mjs';
import { createApp } from './app.mjs';
import { createProviders } from './pay/index.mjs';

const log = message => console.log(`[verify] ${message}`);
const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const store = openStore(join(config.dataDir, 'verify.db'));
const providers = createProviders(config);
const service = createService({ store, config, providers, log });
const server = createServer(createApp({ service, store, providers, config, log }));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

// Daily copy of the database; the last 14 are kept.
function backup() {
  const dir = join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `verify-${new Date().toISOString().slice(0, 10)}.db`;
  const files = readdirSync(dir).filter(f => /^verify-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  if (!files.includes(name)) store.db.exec(`vacuum into '${join(dir, name).replaceAll("'", "''")}'`);
  for (const old of readdirSync(dir).filter(f => /^verify-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14)) rmSync(join(dir, old));
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    await service.tick();
    backup();
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
