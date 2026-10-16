import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { serviceContractReady, SERVICE_CONTRACT } from '../assets/gettoken/verify-rules.mjs';
import { READY_CONTRACT } from './helpers/service-contract.mjs';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { mockProvider } from '../server/verify/pay/mock.mjs';

test('all service contract fields are required; production remains unapproved', () => {
  assert.equal(serviceContractReady(SERVICE_CONTRACT), false);
  assert.equal(serviceContractReady(READY_CONTRACT), true);
  for (const key of Object.keys(READY_CONTRACT)) {
    assert.equal(serviceContractReady({ ...READY_CONTRACT, [key]: '' }), false, key);
  }
});
test('production opening needs service definition, operator, provider and explicit switch', async t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  const config = { mode: 'live', acceptNewOrders: true, secret: randomBytes(32) };
  const service = createService({ store, config, providers: { mock: mockProvider() } });
  assert.equal(service.acceptingNewOrders(), false);
  await assert.rejects(service.createOrder({ code: 'sk-' + 'a'.repeat(45), agree: true, channel: 'mock' }), /暂未开通/);
  assert.equal(store.get('select count(*) as n from orders').n, 0);
  config.serviceContract = READY_CONTRACT;
  assert.equal(service.acceptingNewOrders(), false);
  store.setSetting('admin_password', 'synthetic test marker');
  assert.equal(service.acceptingNewOrders(), true);
  const order = await service.createOrder({ code: 'sk-' + 'a'.repeat(45), agree: true, channel: 'mock' });
  config.acceptNewOrders = false;
  assert.equal(service.acceptingNewOrders(), false);
  service.markPaid(order.payment.id, { tradeNo: 'synthetic', amountMinor: 33000 });
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
  assert.throws(() => service.decide(order.id, 'passed'), /证据摘要/);
  service.decide(order.id, 'passed', 'Synthetic completed actions');
  assert.equal((await service.lookup(order.id)).reason, 'Synthetic completed actions');
});
