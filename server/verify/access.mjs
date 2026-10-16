import { timingSafeEqual } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { sha256, token } from './secure.mjs';
import { ORDER_PATTERN } from '../../assets/gettoken/verify-rules.mjs';

export const accessDigest = (id, value) => sha256(`order-access:${id}:${value}`);
export function validOrderAccess(id, value, expected) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value || '') || !/^[0-9a-f]{64}$/.test(expected || '')) return false;
  return timingSafeEqual(Buffer.from(accessDigest(id, value), 'hex'), Buffer.from(expected, 'hex'));
}
export const legacyOrderCount = store => store.get('select count(*) as n from orders where access_hash is null').n;
export function assertAccessMigration(store) {
  const count = legacyOrderCount(store);
  if (count) throw new Error(`Order access migration required for ${count} legacy orders. Keep the previous release active; see docs/order-access-migration.md.`);
}

// The authenticated server operator verifies ownership out of band. Recovery
// writes the bearer link once to a NEW private file, never stdout or events.
export function issueOrderAccess({ store, id, output, origin, rotate = false }) {
  if (!ORDER_PATTERN.test(id || '') || !isAbsolute(output || '')) throw new Error('Provide ORDER_ID and a new absolute private output path');
  const row = store.get('select access_hash from orders where id = ?', id);
  if (!row) throw new Error('Order not found');
  if (row.access_hash && !rotate) throw new Error('Access already issued; use rotate-access only after verifying ownership');
  const value = token();
  const address = new URL('/verify/', origin);
  address.searchParams.set('order', id); address.hash = `access=${value}`;
  writeFileSync(output, JSON.stringify({ order: id, queryLink: address.href }) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    store.transaction(() => {
      const changed = store.run('update orders set access_hash = ? where id = ? and access_hash is ?', accessDigest(id, value), id, row.access_hash);
      if (changed.changes !== 1) throw new Error('Order access changed concurrently; retry after inspection');
      store.run('insert into events(order_id, at, actor, kind) values(?, ?, ?, ?)', id, Date.now(), 'cli', rotate ? 'access_rotated' : 'access_issued');
    });
  } catch (error) { unlinkSync(output); throw error; }
}
