#!/usr/bin/env node
// Read-only production acceptance. No orders, credentials, money or admin writes.
import assert from 'node:assert/strict';
import { curlRequest } from './check-live-seo.mjs';
import { SITE } from '../content/site.mjs';
const response = await curlRequest(new URL('/api/verify/config', SITE.origin).href);
assert.equal(response.status, 200, 'Intake configuration must be available');
const config = JSON.parse(await response.text());
assert.equal(config.intakeMode, 'external', 'Production must use external Taobao intake');
assert.deepEqual(config.channels, [], 'Online payment channels must remain hidden');
assert.equal(config.fees, null, 'No unverified Taobao amounts may be advertised');
assert.equal(config.acceptingOrders, true, 'Taobao submissions must be available; check operator password and intake pause flag');
console.log('Production Taobao intake verified: available, external mode, no online payment channels or assumed fees. Read-only checks only.');
