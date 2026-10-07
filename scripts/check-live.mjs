import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const require = createRequire(`${process.env.PLAYWRIGHT_ROOT}/package.json`);
const { chromium } = require('playwright');
const origin = 'http://39.97.40.89';
const expected = 'ffa801a4d55ade18f827e4f684db900fd61af988';
const report = { origin, expectedCommit: expected, checks: [], observations: {}, errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => {
  if (response.url().startsWith(origin) && response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`);
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
try {
  const marker = await context.request.get(`${origin}/deployment.json`);
  assert.equal(marker.status(), 200, 'Deployment marker must be public');
  assert.equal((await marker.json()).commit, expected, 'Deployed commit must match main');
  report.checks.push('Deployed commit matches main');
  const resources = ['index.html', 'assets/gettoken/home.css', 'assets/gettoken/home.mjs', 'assets/gettoken/catalog.mjs', 'assets/gettoken/site.config.mjs', 'assets/gettoken/motion.mjs', 'assets/gettoken/scenes.mjs', 'assets/gettoken/logo.png', 'assets/gettoken/favicon.svg'];
  for (const path of resources) {
    const response = await context.request.get(`${origin}/${path}`);
    assert.equal(response.status(), 200, path);
    assert.equal(sha256(await response.body()), sha256(await readFile(path)), `Content mismatch: ${path}`);
    if (path.endsWith('.mjs')) assert.match(response.headers()['content-type'], /(?:application|text)\/javascript/, path);
  }
  report.checks.push('All 9 site files return 200, match main, and modules have JavaScript MIME types');
  await page.goto(origin, { waitUntil: 'networkidle', timeout: 45000 });
  assert.match(await page.locator('h1').innerText(), /让创造/);
  report.observations.title = await page.title();
  report.observations.webgl = await page.locator('.hero').evaluate(el => el.classList.contains('has-scene'));
  report.observations.prices = await page.locator('[data-price]').allTextContents();
  report.observations.canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  await page.locator('input[name="codex-tier"][value="flagship"]').check();
  await page.locator('input[name="codex-period"][value="12"]').check();
  const buy = page.locator('[data-product="codex"] [data-buy]');
  await buy.click();
  await page.locator('#pay-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-pay-list]').innerText(), /12 个月/);
  assert.match(await page.locator('[data-pay-title]').innerText(), /Codex/);
  assert.match(await page.locator('[data-pay-ref]').innerText(), /^GT-/);
  await page.locator('[data-pay-methods] button').nth(1).click();
  assert.equal(await page.locator('[data-pay-methods] button').nth(1).getAttribute('aria-selected'), 'true');
  report.observations.paymentQr = await page.locator('[data-pay-qr]').innerText();
  report.observations.contact = await page.locator('[data-pay-contact]').innerText();
  await page.keyboard.press('Escape');
  await page.locator('#pay-dialog').waitFor({ state: 'hidden' });
  assert.equal(await buy.evaluate(el => document.activeElement === el), true, 'Focus returns after Escape');
  report.checks.push('Tier/period selection, payment dialog, payment methods, reference, Escape and focus restoration');
  await page.locator('[data-preset="codex:standard:3"]').click();
  assert.equal(await page.locator('input[name="codex-tier"][value="standard"]').isChecked(), true);
  assert.equal(await page.locator('input[name="codex-period"][value="3"]').isChecked(), true);
  report.checks.push('Preset correctly updates pricing selections');
  await page.locator('[data-open-query]').first().click();
  await page.locator('#query-dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('#query-dialog').waitFor({ state: 'hidden' });
  report.checks.push('Order/contact dialog opens and closes');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of ['.hero', '#products', '#pricing', '#tiers', '#scenes', '#faq']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `${width}px overflow at ${selector}`);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.menu-toggle').click();
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('#mobile-nav a[href="#pricing"]').click();
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
  const ipBuy = page.locator('[data-product="ip"] [data-buy]');
  await ipBuy.click();
  await page.locator('#pay-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-pay-title]').innerText(), /住宅 IP/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  await page.keyboard.press('Escape');
  report.checks.push('Desktop/mobile sections have no horizontal overflow; mobile navigation and IP purchase dialog work');
  assert.deepEqual(report.errors, [], 'No JavaScript errors or failed site resources');
  report.checks.push('No JavaScript exceptions or missing resources');
  try {
    const response = await context.request.get('https://39.97.40.89/', { timeout: 10000 });
    report.observations.https = { status: response.status() };
  } catch (error) {
    report.observations.https = { available: false, reason: error.message.split('\n')[0] };
  }
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile('live-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
