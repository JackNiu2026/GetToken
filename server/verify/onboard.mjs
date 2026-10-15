// Server-only merchant onboarding. Never write credentials into the website archive.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';

export function parseEnvironment(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('Unsupported environment line; use KEY=value');
    let value = match[2].trim();
    if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.slice(1, -1).includes("'")) throw new Error(`Invalid quoted value for ${match[1]}`);
      value = value.slice(1, -1);
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error(`Invalid quoted value for ${match[1]}`); }
    }
    env[match[1]] = value;
  }
  return env;
}

export function generateAlipayKeys(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o750 });
  const privateFile = join(directory, 'alipay_app_private.pem');
  const publicFile = join(directory, 'alipay_app_public.pem');
  if (existsSync(privateFile) || existsSync(publicFile)) throw new Error('Alipay key files already exist; will not replace them');
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(privateFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(publicFile, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
  return { privateFile, publicFile };
}

export function prepareMerchantConfig(bundleFile, envFile, keysRoot) {
  const bundlePath = resolve(bundleFile);
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  if (!bundle?.alipay || !bundle?.wechat) throw new Error('Merchant bundle must contain both alipay and wechat');
  const env = parseEnvironment(readFileSync(envFile, 'utf8'));
  // Preserve the existing encryption key. No generation or rotation here.
  if (!env.VERIFY_SECRET) throw new Error('Install the service first; existing VERIFY_SECRET is required');
  mkdirSync(keysRoot, { recursive: true, mode: 0o750 });
  const keyDir = mkdtempSync(join(resolve(keysRoot), 'merchant-'));
  chmodSync(keyDir, 0o750);
  const copy = (file, name) => {
    if (typeof file !== 'string' || !file) throw new Error(`Missing merchant file: ${name}`);
    const target = join(keyDir, name);
    copyFileSync(resolve(dirname(bundlePath), file), target);
    chmodSync(target, 0o640);
    return target;
  };
  env.ALIPAY_APP_ID = bundle.alipay.appId;
  env.ALIPAY_SELLER_ID = bundle.alipay.sellerId;
  env.ALIPAY_PRIVATE_KEY_FILE = copy(bundle.alipay.privateKeyFile, 'alipay_app_private.pem');
  env.ALIPAY_PUBLIC_KEY_FILE = copy(bundle.alipay.platformPublicKeyFile, 'alipay_public.pem');
  env.WECHAT_MCHID = bundle.wechat.mchid;
  env.WECHAT_APPID = bundle.wechat.appid;
  env.WECHAT_APIV3_KEY = bundle.wechat.apiV3Key;
  env.WECHAT_PRIVATE_KEY_FILE = copy(bundle.wechat.privateKeyFile, 'apiclient_key.pem');
  env.WECHAT_PAY_PUBLIC_KEY_FILE = copy(bundle.wechat.platformPublicKeyFile, 'wechatpay_public.pem');
  env.WECHAT_PAY_PUBLIC_KEY_ID = bundle.wechat.platformPublicKeyId;
  env.WECHAT_CERT_FILE = copy(bundle.wechat.certificateFile, 'apiclient_cert.pem');
  env.WECHAT_SERIAL_NO = new X509Certificate(readFileSync(env.WECHAT_CERT_FILE)).serialNumber;
  env.VERIFY_PUBLIC_ORIGIN = bundle.origin || 'https://gettoken.cc';
  env.VERIFY_PAY_MODE = 'live';
  env.VERIFY_ACCEPT_NEW_ORDERS = 'false';
  // Imported credentials always use the production endpoints.
  delete env.ALIPAY_GATEWAY;
  delete env.WECHAT_API_BASE;
  loadConfig(env); // Parse keys and check certificate/key pair before replacing anything.
  const text = Object.entries(env).map(([key, value]) => {
    if (typeof value !== 'string' || /['\r\n\0]/.test(value)) throw new Error(`Invalid environment value: ${key}`);
    return `${key}='${value}'`;
  }).join('\n') + '\n';
  const candidate = `${resolve(envFile)}.candidate`;
  writeFileSync(candidate, text, { mode: 0o600 });
  chmodSync(candidate, 0o600);
  return { candidate, keyDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'keys' && args.length === 1) console.log(JSON.stringify(generateAlipayKeys(resolve(args[0]))));
    else if (command === 'configure' && args.length === 3) console.log(JSON.stringify(prepareMerchantConfig(...args)));
    else throw new Error('Usage: onboard.mjs keys DIR | configure BUNDLE_JSON ENV_FILE KEYS_DIR');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
