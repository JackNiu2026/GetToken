// Test mode (VERIFY_PAY_MODE=mock): no money moves. The QR code only carries the payment id,
// and a payment is marked paid from the admin page ("模拟收款"), which needs the admin password.
export function mockProvider() {
  return {
    name: 'mock',
    label: '测试通道',
    async precreate({ outTradeNo }) {
      return { qr: `GETTOKEN-TEST-PAYMENT:${outTradeNo}` };
    },
    async query() {
      return { paid: false };
    },
    async refund() {
      return { status: 'success' };
    },
    async refundQuery() {
      return { status: 'success' };
    },
  };
}
