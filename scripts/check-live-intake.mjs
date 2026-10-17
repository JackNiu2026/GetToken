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

const guidePage = await curlRequest(new URL('/verify/', SITE.origin).href);
assert.equal(guidePage.status, 200);
const guideHtml = await guidePage.text();
assert.match(guideHtml, /data-key-guide-open/, 'Tutorial entry must be deployed');
assert.ok(guideHtml.indexOf('data-key-guide-open') < guideHtml.indexOf('data-code required'), 'Tutorial entry must precede the Session Key input');
assert.doesNotMatch(guideHtml, /data-session-extract|data-session-install/, 'The retired extension flow must not be offered');
const guideModule = await curlRequest(new URL('/assets/gettoken/verify-key-guide.mjs', SITE.origin).href);
assert.equal(guideModule.status, 200, 'Tutorial player module must be available');
const guideVideo = await curlRequest(new URL('/assets/gettoken/session-key-guide.mp4', SITE.origin).href, { headers: { Range: 'bytes=0-31' } });
assert.equal(guideVideo.status, 206, 'Tutorial MP4 must support seeking via byte ranges');
assert.match(guideVideo.headers.get('content-type') || '', /video\/mp4/);
assert.equal((await guideVideo.text()).slice(4, 8), 'ftyp', 'Video must be MP4, not an HTML fallback');
const captions = await curlRequest(new URL('/assets/gettoken/session-key-guide.vtt', SITE.origin).href);
assert.equal(captions.status, 200);
assert.match(captions.headers.get('content-type') || '', /text\/vtt/);
assert.ok((await captions.text()).startsWith('WEBVTT'));
console.log('Production tutorial verified: entry above Session Key input, player module, seekable MP4 and Chinese captions available. No credentials were read or submitted.');
