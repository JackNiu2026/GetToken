// Reads the service configuration from the environment (systemd loads /etc/gettoken/verify.env).
// Secrets stay on the server: keys are read from files whose paths are configured here.
import { readFileSync } from 'node:fs';

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
  if (origin.protocol !== 'https:' && mode === 'live') throw new Error('VERIFY_PUBLIC_ORIGIN must use HTTPS for live payments');

  const alipay = env.ALIPAY_APP_ID ? {
    appId: env.ALIPAY_APP_ID,
    gateway: env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    privateKey: readKey(env.ALIPAY_PRIVATE_KEY_FILE, 'ALIPAY_PRIVATE_KEY_FILE'),
    publicKey: readKey(env.ALIPAY_PUBLIC_KEY_FILE, 'ALIPAY_PUBLIC_KEY_FILE'),
  } : null;
  if (alipay && (!alipay.privateKey || !alipay.publicKey)) throw new Error('Alipay needs ALIPAY_PRIVATE_KEY_FILE and ALIPAY_PUBLIC_KEY_FILE');

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
  }

  return Object.freeze({
    host: env.VERIFY_HOST || '127.0.0.1',
    port: Number(env.VERIFY_PORT || 8790),
    dataDir: env.VERIFY_DATA_DIR || '/var/lib/gettoken-verify',
    origin: origin.origin,
    secret: Buffer.from(secret, 'hex'),
    mode,
    alipay: mode === 'live' ? alipay : null,
    wechat: mode === 'live' ? wechat : null,
    purgeDays: Number(env.VERIFY_PURGE_DAYS || 7),
  });
}
