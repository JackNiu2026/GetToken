// Identifiers, code encryption and the admin password hash.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// Beijing calendar parts, used for order numbers and "today" counts.
export function beijing(ms) {
  const d = new Date(ms + 8 * 3600_000);
  const p = n => String(n).padStart(2, '0');
  return { y: d.getUTCFullYear(), mmdd: `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`, text: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` };
}
export const beijingDayStart = ms => Math.floor((ms + 8 * 3600_000) / 86_400_000) * 86_400_000 - 8 * 3600_000;

export function orderId(now) {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `GT-VF-${beijing(now).mmdd}-${suffix}`;
}
// Payment platforms accept letters and digits only, so the dashes go.
export const compactId = id => id.replaceAll('-', '');

function keys(secret) {
  return {
    enc: createHmac('sha256', secret).update('verify:code-encryption').digest(),
    mac: createHmac('sha256', secret).update('verify:fingerprint').digest(),
  };
}

export function sealCode(secret, code) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys(secret).enc, iv);
  const data = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function openCode(secret, sealed) {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keys(secret).enc, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
// Same code, same fingerprint: lets the admin page flag repeats without storing the code twice.
export const fingerprint = (secret, value) => createHmac('sha256', keys(secret).mac).update(value).digest('hex').slice(0, 32);

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');

const SCRYPT = { N: 16384, r: 8, p: 1 };
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}
