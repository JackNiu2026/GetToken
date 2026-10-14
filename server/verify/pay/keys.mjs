// Payment platforms hand out keys either as PEM files or as bare base64; accept both.
import { createPrivateKey, createPublicKey } from 'node:crypto';

const bare = text => Buffer.from(text.replace(/\s+/g, ''), 'base64');

export function privateKey(text) {
  if (text.includes('-----BEGIN')) return createPrivateKey(text);
  try {
    return createPrivateKey({ key: bare(text), format: 'der', type: 'pkcs8' });
  } catch {
    return createPrivateKey({ key: bare(text), format: 'der', type: 'pkcs1' });
  }
}

export function publicKey(text) {
  if (text.includes('-----BEGIN')) return createPublicKey(text);
  return createPublicKey({ key: bare(text), format: 'der', type: 'spki' });
}

// "330.00" -> 33000. Platforms send amounts as decimal strings; never trust floats with money.
export function yuanToMinor(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return NaN;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}
export const minorToYuan = minor => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;

// Beijing wall-clock time, the format both platforms expect.
export function beijingTime(ms, iso = false) {
  const d = new Date(ms + 8 * 3600_000);
  const p = n => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  return iso ? `${date}T${time}+08:00` : `${date} ${time}`;
}
