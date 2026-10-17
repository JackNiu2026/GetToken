export const PAGE = 'https://gettoken.cc/verify/';
export const CLAUDE = 'https://claude.ai/';
export const TTL = 120_000;
export const PREFIX = 'request:';

export function allowedPage(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://gettoken.cc' && url.pathname === '/verify/'
      && !url.username && !url.password;
  } catch { return false; }
}
export function allowedSender(sender, extensionId) {
  return sender?.id === extensionId && sender.frameId === 0
    && Number.isInteger(sender.tab?.id) && !sender.tab.incognito
    && typeof sender.documentId === 'string' && allowedPage(sender.url);
}
export function usableKey(value) {
  return typeof value === 'string' && value.length >= 40 && value.length <= 4096
    && /^sk[A-Za-z0-9_-]+$/.test(value);
}
export function currentRequest(value, now = Date.now()) {
  return value && typeof value.id === 'string' && Number.isInteger(value.tabId)
    && typeof value.documentId === 'string' && Number.isFinite(value.expires)
    && value.expires > now && value.expires <= now + TTL;
}
