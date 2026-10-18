import { SITE } from './site.config.mjs';
import { PRODUCTS } from './catalog.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
export function contactReady(site = SITE) {
  return Boolean(site.contact && [site.contact.wechat, site.contact.telegram, site.contact.email].some(text)
    && text(site.support?.identity) && text(site.support?.hours) && text(site.support?.timeZone));
}

export function inquiryState(product, tier, months, site = SITE) {
  const config = site.inquiries?.[product];
  const ready = Object.hasOwn(PRODUCTS, product) && Object.hasOwn(PRODUCTS[product].tiers, tier)
    && contactReady(site) && config?.enabled === true
    && config.tiers?.includes(tier) && config.periods?.includes(months);
  return ready
    ? { state: 'inquiry', label: '咨询报价', message: '先确认账号资格、交付内容、期限和报价，再决定是否购买。咨询无需提供密码或 Session Key。' }
    : { state: 'unavailable', label: '暂未受理', message: '此方案暂未开放受理，请勿付款或提交账号凭据。可先阅读选购与验收指南。' };
}

export function inquirySummary(quote) {
  return `${quote.name} · ${quote.tierName} · ${quote.deliveryName || '线路规格待确认'} · ${quote.deliveryName ? '按月计费' : `意向周期 ${quote.months} 个月`}。此为咨询需求，不是订单或成交报价。`;
}
