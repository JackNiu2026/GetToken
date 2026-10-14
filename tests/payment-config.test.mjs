import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto';
import { loadConfig } from '../server/verify/config.mjs';
import { generateAlipayKeys, parseEnvironment, prepareMerchantConfig } from '../server/verify/onboard.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gettoken-payment-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const alipay = generateAlipayKeys(join(dir, 'generated'));
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platformFile = join(dir, 'platform.pem');
  writeFileSync(platformFile, platform.publicKey.export({ type: 'spki', format: 'pem' }));
  const certificateFile = join(dir, 'merchant.crt'), privateKeyFile = join(dir, 'merchant.key');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKeyFile, '-out', certificateFile, '-days', '2', '-subj', '/CN=1900000001'], { stdio: 'pipe' });
  const envFile = join(dir, 'verify.env');
  const secret = randomBytes(32).toString('hex');
  const original = `# Existing encrypted orders must remain readable\nVERIFY_SECRET=${secret}\nVERIFY_PAY_MODE=off\n`;
  writeFileSync(envFile, original, { mode: 0o600 });
  const bundle = { origin: 'https://gettoken.cc', alipay: { appId: '2021000000000001', sellerId: '2088000000000001', privateKeyFile: alipay.privateFile, platformPublicKeyFile: platformFile },
    wechat: { mchid: '1900000001', appid: 'wx0000000000000001', apiV3Key: 'k'.repeat(32), privateKeyFile, certificateFile, platformPublicKeyFile: platformFile, platformPublicKeyId: 'PUB_KEY_ID_3000000001' } };
  const bundleFile = join(dir, 'merchant-bundle.json');
  const save = () => writeFileSync(bundleFile, JSON.stringify(bundle), { mode: 0o600 }); save();
  return { dir, bundle, bundleFile, envFile, original, secret, save };
}

test('merchant import validates both accounts, keeps the encryption key and stages a closed live configuration', t => {
  const f = fixture(t);
  const result = prepareMerchantConfig(f.bundleFile, f.envFile, join(f.dir, 'keys'));
  assert.equal(readFileSync(f.envFile, 'utf8'), f.original, 'import does not replace running settings before service health checks');
  const env = parseEnvironment(readFileSync(result.candidate, 'utf8'));
  assert.equal(env.VERIFY_SECRET, f.secret);
  assert.equal(env.VERIFY_PAY_MODE, 'live');
  assert.equal(env.VERIFY_ACCEPT_NEW_ORDERS, 'false');
  assert.equal(env.WECHAT_SERIAL_NO, new X509Certificate(readFileSync(f.bundle.wechat.certificateFile)).serialNumber);
  const config = loadConfig(env);
  assert.ok(config.alipay && config.wechat); assert.equal(config.acceptNewOrders, false);
  assert.equal(statSync(result.candidate).mode & 0o777, 0o600);
  assert.equal(statSync(env.WECHAT_PRIVATE_KEY_FILE).mode & 0o777, 0o640);
  assert.match(readFileSync(result.candidate, 'utf8'), /^VERIFY_SECRET='[a-f0-9]{64}'/m);
});

test('merchant import rejects mismatched certificates, absent merchant PID and incomplete bundles', t => {
  const f = fixture(t);
  f.bundle.wechat.privateKeyFile = f.bundle.alipay.privateKeyFile; f.save();
  assert.throws(() => prepareMerchantConfig(f.bundleFile, f.envFile, join(f.dir, 'keys')), /does not match/);
  assert.equal(readFileSync(f.envFile, 'utf8'), f.original);
  f.bundle.wechat.privateKeyFile = join(f.dir, 'merchant.key');
  delete f.bundle.alipay.sellerId; f.save();
  assert.throws(() => prepareMerchantConfig(f.bundleFile, f.envFile, join(f.dir, 'keys')), /ALIPAY_SELLER_ID/);
  delete f.bundle.alipay; f.save();
  assert.throws(() => prepareMerchantConfig(f.bundleFile, f.envFile, join(f.dir, 'keys')), /both/);
});

test('configuration rejects insecure callback origins, unsafe opening switches and empty live accounts', () => {
  const base = { VERIFY_SECRET: randomBytes(32).toString('hex') };
  assert.throws(() => loadConfig({ ...base, VERIFY_PAY_MODE: 'live', VERIFY_PUBLIC_ORIGIN: 'http://gettoken.cc' }), /HTTPS/);
  for (const url of ['https://gettoken.cc/api/', 'https://user:password@gettoken.cc', 'https://gettoken.cc?x=1']) assert.throws(() => loadConfig({ ...base, VERIFY_PUBLIC_ORIGIN: url }), /origin/);
  assert.throws(() => loadConfig({ ...base, VERIFY_PAY_MODE: 'live' }), /configured merchant/);
  assert.throws(() => loadConfig({ ...base, VERIFY_ACCEPT_NEW_ORDERS: 'yes' }), /true or false/);
  assert.throws(() => loadConfig({ ...base, VERIFY_PORT: 'NaN' }), /VERIFY_PORT/);
});

test('local Alipay key generation never replaces an existing application key', t => {
  const f = fixture(t);
  const before = readFileSync(f.bundle.alipay.privateKeyFile);
  assert.throws(() => generateAlipayKeys(join(f.dir, 'generated')), /will not replace/);
  assert.deepEqual(readFileSync(f.bundle.alipay.privateKeyFile), before);
  assert.equal(statSync(f.bundle.alipay.privateKeyFile).mode & 0o777, 0o600);
});
