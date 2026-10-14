import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { mockProvider } from '../server/verify/pay/mock.mjs';
import { maintainBackups } from '../server/verify/backup.mjs';
import { openCode } from '../server/verify/secure.mjs';

const DAY = 86400000;
const CODE = 'sk-backup-' + 'b'.repeat(45);
function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'gettoken-backup-test-'));
  const store = openStore(join(dataDir, 'verify.db'));
  let now = Date.UTC(2026, 9, 1, 2);
  const config = { secret: randomBytes(32), mode: 'mock' };
  const service = createService({ store, config, providers: { mock: mockProvider() }, now: () => now });
  t.after(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, config, service, now: () => now, add: ms => { now += ms; } };
}
const create = service => service.createOrder({ code: CODE, agree: true, channel: 'mock' });
const backups = f => readdirSync(join(f.dataDir, 'backups')).filter(n => n.endsWith('.db')).sort().map(n => join(f.dataDir, 'backups', n));
const runBackup = f => maintainBackups({ store: f.store, dataDir: f.dataDir, now: f.now() });
function readOrder(file, id) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { ...db.prepare('select * from orders where id = ?').get(id) }; } finally { db.close(); }
}

test('pre-decision backups do not resurrect codes purged from the live database', async t => {
  const f = setup(t);
  const settled = await create(f.service);
  const active = await create(f.service);
  runBackup(f);
  const oldest = backups(f)[0];
  const sealed = readOrder(oldest, settled.id).code_sealed;
  assert.equal(openCode(f.config.secret, sealed), CODE, 'active codes remain recoverable');
  f.service.markPaid(settled.payment.id, { amountMinor: 33000, tradeNo: 'TEST' });
  f.service.decide(settled.id, 'passed');
  f.service.markPaid(active.payment.id, { amountMinor: 33000, tradeNo: 'TEST2' });
  f.add(8 * DAY);
  await f.service.tick();
  runBackup(f);
  assert.equal(f.service.adminDetail(settled.id).code, null);
  for (const file of backups(f)) {
    const removed = readOrder(file, settled.id);
    assert.equal(removed.code_sealed, null);
    assert.ok(removed.purged_at);
    assert.equal(readFileSync(file).includes(Buffer.from(sealed)), false, 'deleted ciphertext does not survive in backup freelists');
    assert.equal(openCode(f.config.secret, readOrder(file, active.id).code_sealed), CODE, 'unsettled reviews are still recoverable');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const restored = openStore(file);
    try {
      const service = createService({ store: restored, config: f.config, providers: {}, now: f.now });
      assert.equal(service.adminDetail(settled.id).code, null, 'restoring the backup cannot bring the purged code back');
    } finally { restored.close(); }
  }
});

test('backups also purge an expired code whose old copy still labels it unpaid', async t => {
  const f = setup(t);
  const order = await create(f.service);
  runBackup(f);
  f.add(8 * DAY);
  await f.service.tick();
  runBackup(f);
  assert.equal(readOrder(backups(f)[0], order.id).code_sealed, null);
});

test('backups retain financial history for fourteen days and are idempotent within a day', async t => {
  const f = setup(t);
  const order = await create(f.service);
  f.service.markPaid(order.payment.id, { amountMinor: 33000, tradeNo: 'TEST' });
  f.service.decide(order.id, 'failed');
  for (let i = 0; i < 16; i += 1) {
    await f.service.tick();
    runBackup(f);
    runBackup(f);
    f.add(DAY);
  }
  assert.equal(backups(f).length, 14);
  const old = readOrder(backups(f)[0], order.id);
  assert.equal(old.status, 'failed');
  assert.equal(old.tech_fee + old.audit_fee, 33000);
  assert.equal(old.code_sealed, null);
});

test('old payment databases gain reconciliation metadata without losing history', t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gettoken-migration-test-'));
  const file = join(dataDir, 'verify.db');
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const legacy = new DatabaseSync(file);
  legacy.exec(`create table payments (id text primary key, order_id text, channel text, status text, amount integer, qr text, trade_no text, created_at integer, expires_at integer, paid_at integer, checked_at integer);
    insert into payments values ('LEGACY', 'OLD-ORDER', 'mock', 'closed', 33000, null, null, 1, 2, null, null)`);
  legacy.close();
  for (let n = 0; n < 2; n += 1) {
    const store = openStore(file);
    try {
      const payment = store.get('select * from payments where id = ?', 'LEGACY');
      assert.equal(payment.amount, 33000);
      assert.equal(payment.status, 'closed');
      assert.equal(payment.reconciled_at, null, 'a local legacy closure still needs reconciliation');
    } finally { store.close(); }
  }
});
