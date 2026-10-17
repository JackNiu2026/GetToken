#!/usr/bin/env node
// Read-only production acceptance. No orders, credentials, money or admin writes.
import assert from 'node:assert/strict';
import { curlRequest } from './check-live-seo.mjs';
import { SITE } from '../content/site.mjs';
const response = await curlRequest(new URL('/api/verify/config', SITE.origin).href);
assert.equal(response.status, 200, 'Intake configuration must be available');
const config = JSON.parse(await response.text());
assert.equal(config.intakeMode, 'external', 'Production must use non-payment intake');
assert.equal(config.submissionMode, 'session-key', 'Only Session Key submissions may be offered');
assert.deepEqual(config.channels, [], 'Online payment channels must remain hidden');
assert.equal(config.fees, null, 'No assumed payment amounts may be advertised');
assert.equal(config.acceptingOrders, true, 'Session Key submissions must be available; check operator password and intake pause flag');
console.log('Production Session Key intake verified: available, external mode, no online payment channels or assumed fees. Read-only checks only.');

const feedResponse = await curlRequest(new URL('/api/verify/feed', SITE.origin).href);
assert.equal(feedResponse.status, 200, 'Passed-record feed must be available');
const feed = JSON.parse(await feedResponse.text());
assert.ok(Number.isInteger(feed.totalPassed) && feed.totalPassed >= feed.today.passed && feed.today.passed >= 0, 'Today and cumulative totals must be real nonnegative counts');
console.log('Production feed verified: today and cumulative passed counts available.');

const helperPage = await curlRequest(new URL('/verify/', SITE.origin).href);
assert.equal(helperPage.status, 200);
const helperHtml = await helperPage.text();
assert.match(helperHtml, /data-session-extract/, 'Session Key helper button must be deployed');
assert.match(helperHtml, /<div\b[^>]*\bdata-session-helper\b[^>]*>/);
assert.doesNotMatch(helperHtml.match(/<div\b[^>]*\bdata-session-helper\b[^>]*>/)[0], /\bhidden\b/, 'Ordinary verify page must not hide the helper behind a test URL');
const helperModule = await curlRequest(new URL('/assets/gettoken/verify-session-helper.mjs', SITE.origin).href);
assert.equal(helperModule.status, 200, 'Helper webpage module must be available');
const helperZip = await curlRequest(new URL('/assets/downloads/gettoken-session-helper.zip', SITE.origin).href);
assert.equal(helperZip.status, 200, 'Developer-mode helper download must be available');
assert.equal((await helperZip.text()).slice(0, 4), 'PK\u0003\u0004', 'Helper download must be a ZIP, not an HTML fallback');
console.log('Production helper delivery verified: ordinary verify page has visible beta markup, webpage module and developer-mode ZIP available. Browser installation and real-account behavior are not tested by these delivery checks.');
