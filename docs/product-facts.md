# 商品事实与供货核验记录

核验日期：2026-10-16。公开参考资料由本轮开发核对；供货、报价及交付负责人尚未提供，以下所有档位都未获准受理。官方参考价不是本站报价，资料核验不是库存验收。

| 商品 / 稳定内部键 | 展示含义 | 供货结论 |
| --- | --- | --- |
| codex / plus | Plus；具体资格和用量以当前账号为准 | 未核实，不受理 |
| codex / pro5x | 展示已改为 Pro 100；旧键保留锚点兼容，不表示 5 倍承诺 | 未核实，不受理 |
| codex / pro20x | 展示已改为 Pro 200；需核实新旧订阅资格 | 未核实，不受理 |
| claude / pro | 个人 Pro；不是团队席位 | 未核实，不受理 |
| claude / max5x | 个人 Max 5x，受官方用量规则约束 | 未核实，不受理 |
| claude / max20x | 个人 Max 20x，受官方用量规则约束 | 未核实，不受理 |
| gemini / plus | Google AI Plus；地区、价格和存储需确认 | 未核实，不受理 |
| gemini / pro | Google AI Pro；个人账号和家庭资格需确认 | 未核实，不受理 |
| gemini / ultra | Google AI Ultra；需注明具体用量版本 | 未核实，不受理 |
| grok / lite | Lite 历史名称，仅作旧记录辨识 | 未核实，不受理 |
| grok / supergrok | SuperGrok 历史名称，非现行目录承诺 | 未核实，不受理 |
| grok / heavy | Heavy 历史名称，未映射至当前方案 | 未核实，不受理 |
| ip / starter | 单一环境需求，非已确认线路规格 | 未核实，不受理 |
| ip / standard | 多环境需求，非已确认线路规格 | 未核实，不受理 |
| ip / premium | 长期需求，非稳定性 SLA | 未核实，不受理 |

## 官方资料

- [ChatGPT Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)：公开列出 Pro 100/200/500，Pro 月付；新旧资格存在差异。个人访问的共享、转售受到官方限制，本站不能只靠第三方声明跳过供应方式核实。
- [Claude 定价](https://claude.com/pricing)：个人 Pro 与 Max、团队方案分开；Pro 月付与年付应分开比较，Max 的特定 API credits 与订阅用量分开核实。以当前官方说明及实际账号为准。
- [Google AI 套餐](https://one.google.com/about/google-ai-plans/)：本次返回地区化页面，不能据此给所有目标账号写固定美元价；Ultra 版本、存储及家庭权益需另核实。
- [Grok 定价](https://x.ai/pricing)：本次公开目录为 Plus/Premium/Super/Ultra；没有证据支持把旧三档逐项替换为本站可售的新三档。

页面公共说明统一来自 `content/product-facts.mjs`。正式开放前，供货负责人须提供可交付账号资格、合法适用的交付方式、地区币种、税费、价格有效期、期限实现、成功证据与不可交付处理。季度/年度需求不自动等于官方多月预付或年付订阅。

IP 还须补充地区库存、协议、静态/动态、独享定义、带宽流量、并发、测试窗口、替换和中断补偿。没有这些资料时不能把“旗舰”当作性能承诺。
