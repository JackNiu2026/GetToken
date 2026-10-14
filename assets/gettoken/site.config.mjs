// Business settings for the static storefront. Edit here; no build step needed.
//
// Payment QR codes: put the image files under assets/gettoken/pay/ and set the
// relative paths below (e.g. './assets/gettoken/pay/wechat.png'). An empty
// string shows the "收款码待上传" placeholder instead of a broken image.
export const SITE = Object.freeze({
  payment: Object.freeze({
    methods: Object.freeze([
      Object.freeze({ key: 'wechat', label: '微信支付', qr: '', currencies: Object.freeze(['CNY']) }),
      Object.freeze({ key: 'alipay', label: '支付宝', qr: '', currencies: Object.freeze(['CNY']) }),
      Object.freeze({ key: 'usdt', label: 'USDT', qr: '', currencies: Object.freeze(['USD']) }),
    ]),
  }),
  // Where customers send the payment screenshot. Leave a field empty to hide it.
  // `wechatQr` is the customer-service WeChat QR image shown by every 微信咨询 / 订单查询
  // button (e.g. './assets/gettoken/pay/wechat-contact.png'; product pages resolve it from the site root).
  contact: Object.freeze({
    wechat: '',
    wechatQr: '',
    telegram: '',
    email: '',
  }),
});
