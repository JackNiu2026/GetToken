import { alipayProvider } from './alipay.mjs';
import { wechatProvider } from './wechat.mjs';
import { mockProvider } from './mock.mjs';

// Channels shown to buyers, in display order. Live mode offers only fully configured channels.
export function createProviders(config, options = {}) {
  if (config.mode === 'mock') return { mock: mockProvider() };
  if (config.mode !== 'live') return {};
  const providers = {};
  const notify = channel => `${config.origin}/api/verify/notify/${channel}`;
  if (config.alipay) providers.alipay = alipayProvider(config.alipay, { ...options, notifyUrl: notify('alipay') });
  if (config.wechat) providers.wechat = wechatProvider(config.wechat, { ...options, notifyUrl: notify('wechat'), refundNotifyUrl: `${config.origin}/api/verify/notify/wechat/refund` });
  return providers;
}
