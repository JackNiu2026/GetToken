// Reads the service configuration from the environment (systemd loads /etc/gettoken/verify.env).
// Secrets stay on the server: keys are read from files whose paths are configured here.
import { readFileSync } from 'node:fs';
import { X509Certificate, createPublicKey } from 'node:crypto';
import { privateKey, publicKey } from './pay/keys.mjs';
import { SERVICE_CONTRACT } from '../../assets/gettoken/verify-rules.mjs';

const MODES = ['off', 'mock', 'live'];

function readKey(path, name) {
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error) {
    throw new Error(`${name}: cannot read ${path} (${error.code})`);
  }
}

export function loadConfig(env = process.env) {
  const secret = env.VERIFY_SECRET || '';
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('VERIFY_SECRET must be 64 hex characters');
  const mode = env.VERIFY_PAY_MODE || 'off';
  if (!MODES.includes(mode)) throw new Error(`VERIFY_PAY_MODE must be one of ${MODES.join(', ')}`);
  const origin = new URL(env.VERIFY_PUBLIC_ORIGIN || 'https://gettoken.cc');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('VERIFY_PUBLIC_ORIGIN must be an origin without credentials, path or query');
  if (origin.protocol !== 'https:' && mode === 'live') throw new Error('VERIFY_PUBLIC_ORIGIN must use HTTPS for live payments');
  if (env.VERIFY_ACCEPT_NEW_ORDERS && !['true', 'false'].includes(env.VERIFY_ACCEPT_NEW_ORDERS)) throw new Error('VERIFY_ACCEPT_NEW_ORDERS must be true or false');

  const alipay = env.ALIPAY_APP_ID ? {
    appId: env.ALIPAY_APP_ID,
    sellerId: env.ALIPAY_SELLER_ID,
    gateway: env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    privateKey: readKey(env.ALIPAY_PRIVATE_KEY_FILE, 'ALIPAY_PRIVATE_KEY_FILE'),
    publicKey: readKey(env.ALIPAY_PUBLIC_KEY_FILE, 'ALIPAY_PUBLIC_KEY_FILE'),
  } : null;
  if (alipay && (!alipay.privateKey || !alipay.publicKey)) throw new Error('Alipay needs ALIPAY_PRIVATE_KEY_FILE and ALIPAY_PUBLIC_KEY_FILE');
  if (alipay && !/^2088\d{12}$/.test(alipay.sellerId || '')) throw new Error('ALIPAY_SELLER_ID must be the 16-digit merchant PID starting with 2088');

  const wechat = env.WECHAT_MCHID ? {
    mchid: env.WECHAT_MCHID,
    appid: env.WECHAT_APPID,
    serialNo: env.WECHAT_SERIAL_NO,
    apiV3Key: env.WECHAT_APIV3_KEY,
    privateKey: readKey(env.WECHAT_PRIVATE_KEY_FILE, 'WECHAT_PRIVATE_KEY_FILE'),
    platformKey: readKey(env.WECHAT_PAY_PUBLIC_KEY_FILE, 'WECHAT_PAY_PUBLIC_KEY_FILE'),
    platformKeyId: env.WECHAT_PAY_PUBLIC_KEY_ID,
    base: env.WECHAT_API_BASE || 'https://api.mch.weixin.qq.com',
  } : null;
  if (wechat) {
    for (const key of ['appid', 'serialNo', 'apiV3Key', 'privateKey', 'platformKey', 'platformKeyId']) {
      if (!wechat[key]) throw new Error(`WeChat Pay needs ${key}; see DEPLOYMENT.md`);
    }
    if (Buffer.byteLength(wechat.apiV3Key) !== 32) throw new Error('WECHAT_APIV3_KEY must be 32 characters');
    if (!/^PUB_KEY_ID_\d+$/.test(wechat.platformKeyId)) throw new Error('WECHAT_PAY_PUBLIC_KEY_ID must use PUB_KEY_ID_<digits> (public-key mode)');
    if (env.WECHAT_CERT_FILE) {
      const cert = new X509Certificate(readKey(env.WECHAT_CERT_FILE, 'WECHAT_CERT_FILE'));
      if (cert.serialNumber.toUpperCase() !== wechat.serialNo.toUpperCase()) throw new Error('WECHAT_SERIAL_NO does not match WECHAT_CERT_FILE');
      if (!cert.publicKey.equals(createPublicKey(privateKey(wechat.privateKey)))) throw new Error('WeChat certificate does not match merchant private key');
      if (Date.now() < Date.parse(cert.validFrom) || Date.now() >= Date.parse(cert.validTo)) throw new Error('WeChat merchant certificate is not currently valid');
    }
  }
  for (const [label, text, parse] of [
    ['ALIPAY_PRIVATE_KEY_FILE', alipay?.privateKey, privateKey], ['ALIPAY_PUBLIC_KEY_FILE', alipay?.publicKey, publicKey],
    ['WECHAT_PRIVATE_KEY_FILE', wechat?.privateKey, privateKey], ['WECHAT_PAY_PUBLIC_KEY_FILE', wechat?.platformKey, publicKey],
  ]) {
    if (!text) continue;
    let key;
    try { key = parse(text); } catch { throw new Error(`${label}: invalid key format`); }
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048) throw new Error(`${label}: RSA 2048 key required`);
  }
  if (mode === 'live' && !alipay && !wechat) throw new Error('Live payments require at least one configured merchant');
  const port = Number(env.VERIFY_PORT || 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VERIFY_PORT must be between 1 and 65535');

  return Object.freeze({
    host: env.VERIFY_HOST || '127.0.0.1',
    port,
    dataDir: env.VERIFY_DATA_DIR || '/var/lib/gettoken-verify',
    origin: origin.origin,
    secret: Buffer.from(secret, 'hex'),
    mode,
    serviceContract: SERVICE_CONTRACT,
    acceptNewOrders: env.VERIFY_ACCEPT_NEW_ORDERS === undefined ? undefined : env.VERIFY_ACCEPT_NEW_ORDERS === 'true',
    alipay: mode === 'live' ? alipay : null,
    wechat: mode === 'live' ? wechat : null,
  });
}
