import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/verify/store.mjs';
import { ensureInitialOperator } from '../server/verify/bootstrap.mjs';
import { checkPassword, hashPassword } from '../server/verify/secure.mjs';
import { createService } from '../server/verify/service.mjs';
function fixture(t) {
  const store = openStore(':memory:'), dir = mkdtempSync(join(tmpdir(), 'gettoken-operator-'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, dir, passwordFile: join(dir, 'initial-password') };
}
test('missing operator is initialized once with a private, random, hashed credential', t => {
  const f = fixture(t), result = ensureInitialOperator(f);
  assert.deepEqual(result, { created: true });
  const password = readFileSync(f.passwordFile, 'utf8').trim();
  assert.match(password, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(f.passwordFile).mode & 0o777, 0o600);
  const hash = f.store.setting('admin_password');
  assert.ok(checkPassword(password, hash)); assert.notEqual(hash, password);
  const service = createService({ store: f.store, config: { externalIntake: true }, providers: {} });
  assert.equal(service.acceptingExternalOrders(), true);
  assert.deepEqual(ensureInitialOperator(f), { created: false });
  assert.equal(f.store.setting('admin_password'), hash);
  assert.equal(readFileSync(f.passwordFile, 'utf8').trim(), password);
});
test('existing operator and sessions are never replaced, even without an initial-password file', t => {
  const f = fixture(t), hash = hashPassword('existing-synthetic-password');
  f.store.setSetting('admin_password', hash);
  f.store.run('insert into sessions(hash, expires_at) values(?, ?)', 'synthetic-session', Date.now() + 10000);
  assert.deepEqual(ensureInitialOperator(f), { created: false });
  assert.equal(f.store.setting('admin_password'), hash);
  assert.equal(f.store.get('select count(*) as n from sessions').n, 1);
  assert.throws(() => readFileSync(f.passwordFile), { code: 'ENOENT' });
});
test('existing files, symlinks and unwritable destinations cannot leave an inaccessible operator', t => {
  const f = fixture(t), target = join(f.dir, 'existing');
  writeFileSync(target, 'keep'); symlinkSync(target, f.passwordFile);
  assert.throws(() => ensureInitialOperator(f), { code: 'EEXIST' });
  assert.equal(readFileSync(target, 'utf8'), 'keep');
  assert.equal(f.store.setting('admin_password'), null);
  assert.throws(() => ensureInitialOperator({ ...f, passwordFile: join(f.dir, 'missing/initial-password') }), { code: 'ENOENT' });
  assert.equal(f.store.setting('admin_password'), null);
});
