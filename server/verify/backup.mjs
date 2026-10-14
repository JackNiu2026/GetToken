// Keep operational backups while applying the same code-retention policy to every
// managed copy. A pre-decision backup must not resurrect a subsequently purged code.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { VERIFY } from '../../assets/gettoken/verify-rules.mjs';

const NAME = /^verify-\d{4}-\d{2}-\d{2}\.db$/;
const DAY = 86400000;

export function maintainBackups({ store, dataDir, now = Date.now() }) {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const names = () => readdirSync(dir).filter(f => NAME.test(f)).sort();
  const purged = new Map(store.all('select id, purged_at from orders where purged_at is not null').map(o => [o.id, o.purged_at]));
  const cutoff = now - VERIFY.purgeDays * DAY;

  // Scrub existing copies first, even if making today's backup subsequently fails.
  for (const name of names()) {
    const file = join(dir, name);
    if (!lstatSync(file).isFile()) throw new Error(`Managed backup is not a regular file: ${name}`);
    const db = new DatabaseSync(file);
    try {
      db.exec('pragma busy_timeout = 5000; pragma secure_delete = on');
      const rows = db.prepare('select id, status, created_at, decided_at from orders where code_sealed is not null').all();
      const expired = rows.filter(o => purged.has(o.id) || (o.decided_at !== null && o.decided_at < cutoff) || (o.status === 'expired' && o.created_at < cutoff));
      if (expired.length) {
        const update = db.prepare('update orders set code_sealed = null, purged_at = ? where id = ?');
        db.exec('begin immediate');
        try {
          for (const o of expired) update.run(purged.get(o.id) ?? now, o.id);
          db.exec('commit');
        } catch (error) { db.exec('rollback'); throw error; }
        // Remove old ciphertext from freelists and any WAL, too.
        db.exec('vacuum; pragma wal_checkpoint(truncate)');
      }
    } finally { db.close(); }
    chmodSync(file, 0o600);
  }

  const name = `verify-${new Date(now).toISOString().slice(0, 10)}.db`;
  if (!names().includes(name)) {
    const file = join(dir, name);
    store.db.exec(`vacuum into '${file.replaceAll("'", "''")}'`);
    chmodSync(file, 0o600);
  }
  for (const old of names().slice(0, -14)) {
    rmSync(join(dir, old));
    for (const suffix of ['-wal', '-shm', '-journal']) rmSync(join(dir, old + suffix), { force: true });
  }
}
