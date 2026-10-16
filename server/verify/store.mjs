// SQLite storage (node:sqlite, built into Node 22). One file under the data directory.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
pragma journal_mode = wal;
pragma foreign_keys = on;
pragma busy_timeout = 5000;
pragma secure_delete = on;
create table if not exists orders (
  id text primary key,
  code_sealed text,
  code_tail text not null,
  code_fp text not null,
  show_public integer not null default 0,
  status text not null,
  tech_fee integer not null,
  audit_fee integer not null,
  created_at integer not null,
  paid_at integer,
  due_at integer,
  decided_at integer,
  reason text,
  refund_status text,
  refund_due_at integer,
  refunded_at integer,
  paid_payment text,
  ip_hash text,
  purged_at integer,
  access_hash text
);
create index if not exists orders_status on orders(status, created_at);
create index if not exists orders_decided on orders(decided_at);
create table if not exists payments (
  id text primary key,
  order_id text not null references orders(id),
  channel text not null,
  status text not null,
  amount integer not null,
  qr text,
  trade_no text,
  created_at integer not null,
  expires_at integer not null,
  paid_at integer,
  checked_at integer,
  reconciled_at integer
);
create index if not exists payments_order on payments(order_id);
create index if not exists payments_trade on payments(channel, trade_no);
create table if not exists refunds (
  id text primary key,
  order_id text not null references orders(id),
  payment_id text not null references payments(id),
  channel text not null,
  kind text not null,
  amount integer not null,
  status text not null,
  error text,
  attempts integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists refunds_status on refunds(status);
create table if not exists events (
  id integer primary key autoincrement,
  order_id text,
  at integer not null,
  actor text not null,
  kind text not null,
  detail text
);
create index if not exists events_order on events(order_id, at);
create table if not exists settings (key text primary key, value text not null);
create table if not exists sessions (hash text primary key, expires_at integer not null);
`;

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // Existing releases marked payments closed locally without asking the platform.
  // A null reconciliation timestamp keeps those rows eligible for recovery.
  db.exec('begin immediate');
  try {
    if (!db.prepare('pragma table_info(orders)').all().some(column => column.name === 'access_hash')) {
      db.exec('alter table orders add column access_hash text');
    }
    if (!db.prepare('pragma table_info(payments)').all().some(column => column.name === 'reconciled_at')) {
      db.exec('alter table payments add column reconciled_at integer');
    }
    db.exec('commit');
  } catch (error) { db.exec('rollback'); db.close(); throw error; }
  const cache = new Map();
  const stmt = sql => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };
  const plain = row => (row ? { ...row } : null);
  return {
    db,
    get: (sql, ...args) => plain(stmt(sql).get(...args)),
    all: (sql, ...args) => stmt(sql).all(...args).map(plain),
    run: (sql, ...args) => stmt(sql).run(...args),
    transaction(fn) {
      db.exec('begin immediate');
      try {
        const result = fn();
        db.exec('commit');
        return result;
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
    setting: key => stmt('select value from settings where key = ?').get(key)?.value ?? null,
    setSetting: (key, value) => stmt('insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value').run(key, value),
    close: () => db.close(),
  };
}
