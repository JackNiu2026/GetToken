// Exercise the actual release coordinator's failure paths in a private filesystem.
// Service commands are stubs; real Nginx/API behavior is tested by test-verify-api.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REVISION = 'a'.repeat(40);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gettoken-payment-deploy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const site = join(dir, 'site'), api = join(dir, 'api'), nginx = join(dir, 'nginx'), bin = join(dir, 'bin'), scripts = join(dir, 'scripts');
  for (const path of [site, api, join(nginx, 'conf.d'), bin, scripts, join(site, 'old'), join(api, 'old'), join(api, 'new')]) mkdirSync(path, { recursive: true });
  symlinkSync(join(site, 'old'), join(site, 'current')); symlinkSync(join(api, 'old'), join(api, 'current'));
  const archive = join(dir, 'site.tar.gz');
  execFileSync(process.execPath, ['scripts/package-site.mjs', archive], { cwd: ROOT, stdio: 'pipe' });
  let source = readFileSync(join(ROOT, 'scripts/server-deploy.sh'), 'utf8');
  source = source.replace('[[ $EUID -eq 0 ]]', 'true').replaceAll('/var/lock/gettoken-deploy.lock', join(dir, 'deploy.lock'))
    .replaceAll('/var/www/gettoken', site).replaceAll('/opt/gettoken/verify', api).replaceAll('/etc/nginx', nginx)
    .replaceAll('/tmp/gettoken-seo-routing', join(dir, 'routing'));
  const coordinator = join(scripts, 'server-deploy.sh'); writeFileSync(coordinator, source);
  writeFileSync(join(scripts, 'verify-api.tar.gz'), 'fixture');
  writeFileSync(join(scripts, 'install-verify.sh'), `#!/bin/bash
set -eu
if [[ "\${PAYMENT_TEST_INSTALL_FAIL:-0}" == 1 ]]; then exit 1; fi
ln -sfn '${join(api, 'new')}' '${join(api, 'current')}'
`);
  writeFileSync(join(bin, 'systemctl'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$PAYMENT_TEST_LOG"\n', { mode: 0o755 });
  for (const command of ['nginx', 'python3']) writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
url=''
for arg in "$@"; do if [[ "$arg" == http://* ]]; then url="$arg"; fi; done
case "$url" in
  */api/verify/health) if [[ "\${PAYMENT_TEST_HEALTH_FAIL:-0}" == 1 ]]; then echo '{"ok":false}'; else echo '{"ok":true}'; fi;;
  http://127.0.0.1/) if [[ "\${PAYMENT_TEST_SITE_FAIL:-0}" == 1 ]]; then exit 22; fi;;
  */__gettoken_seo_missing_page__/) echo 404;;
  */guides/index.html) printf 'HTTP/1.1 301\\nLocation: /guides/\\n';;
  */claude) printf 'HTTP/1.1 301\\nLocation: /claude/\\n';;
  */navigation/) printf 'HTTP/1.1 301\\nLocation: /guides/\\n';;
  */deployment.json) printf '{"commit":"%s"}' "$PAYMENT_TEST_REVISION";;
  *.mjs) echo 'Content-Type: application/javascript';;
esac
`, { mode: 0o755 });
  const run = flags => spawnSync('bash', [coordinator, archive, REVISION, 'gettoken.cc', 'v22.22.0'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PAYMENT_TEST_LOG: join(dir, 'commands.log'), PAYMENT_TEST_REVISION: REVISION, ...flags }, encoding: 'utf8', timeout: 15000,
  });
  const previous = () => { assert.equal(readlinkSync(join(site, 'current')), join(site, 'old')); assert.equal(readlinkSync(join(api, 'current')), join(api, 'old')); };
  return { run, previous, dir, site, api };
}

test('an unavailable bundled payment API blocks publishing and keeps both previous releases', t => {
  const f = fixture(t), result = f.run({ PAYMENT_TEST_INSTALL_FAIL: '1' });
  assert.equal(result.status, 1, result.stdout + result.stderr); f.previous();
  assert.match(result.stderr, /Payment API installation failed/);
});

test('a website health failure restores the previous payment backend as well as the website', t => {
  const f = fixture(t), result = f.run({ PAYMENT_TEST_SITE_FAIL: '1' });
  assert.equal(result.status, 1, result.stdout + result.stderr); f.previous();
  assert.match(readFileSync(join(f.dir, 'commands.log'), 'utf8'), /restart gettoken-verify/);
});

test('a broken payment proxy blocks release instead of reporting a warning and success', t => {
  const f = fixture(t), result = f.run({ PAYMENT_TEST_HEALTH_FAIL: '1' });
  assert.equal(result.status, 1, result.stdout + result.stderr); f.previous();
  assert.match(result.stderr, /Nginx payment API health check failed/);
});

test('healthy payment and website releases switch together', t => {
  const f = fixture(t), result = f.run({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readlinkSync(join(f.api, 'current')), join(f.api, 'new'));
  assert.notEqual(readlinkSync(join(f.site, 'current')), join(f.site, 'old'));
});
