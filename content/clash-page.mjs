import { MAX_PROXIES, MAX_SOURCE, SUBSCRIPTION_DAYS } from '../assets/gettoken/clash-config.mjs';

export const CLASH_BODY = `<main id="main" class="c-main g-shell">
<nav class="g-crumbs" aria-label="面包屑"><ol><li><a href="../">首页</a></li><li><a href="../ip/">住宅IP</a></li><li><span aria-current="page">订阅转换</span></li></ol></nav>
<div class="c-intro"><div><h1>SOCKS5 订阅转换</h1><p>粘贴代理信息，选择 Clash 或小火箭，生成对应的订阅链接。<br>支持批量转换和 YAML 配置下载。</p></div><a class="c-help-link" href="#instructions">如何导入</a></div>
<noscript><p class="c-error">请启用 JavaScript 后转换代理配置。</p></noscript>
<div class="c-workspace">
<section class="c-editor" aria-labelledby="input-title">
<div class="c-panel-head"><h2 id="input-title">输入代理</h2><button type="button" class="c-text-button" id="clash-example">填入示例</button></div>
<form id="clash-form">
<fieldset id="clash-fields">
<label for="clash-source">SOCKS5 代理信息 <span>每行一个，最多 ${MAX_PROXIES} 个</span></label>
<textarea id="clash-source" name="source" rows="8" required maxlength="${MAX_SOURCE}" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="clash-formats" placeholder="socks5://user:password@203.0.113.10:1080#我的节点&#10;203.0.113.20:1080:user:password&#10;203.0.113.30:1080"></textarea>
<p class="c-hint" id="clash-formats">支持 IP:端口:账号:密码、账号:密码@IP:端口、socks5://、socks5h:// 和 Base64 socks:// 分享链接。IPv6 地址需加方括号；URI 凭据中的特殊字符用百分号编码，冒号格式中的密码原样保留。</p>
<div class="c-target"><label for="clash-format">目标客户端</label><select id="clash-format" name="format"><option value="clash">Clash / Clash Verge</option><option value="shadowrocket">小火箭 Shadowrocket</option></select><p class="c-hint">选择客户端后再生成。小火箭使用独立的 YAML 节点订阅，保留完整账号密码。</p></div>
<div class="c-options"><div><label for="clash-name">订阅名称</label><input id="clash-name" name="name" value="SOCKS5 订阅" maxlength="60" required autocomplete="off"></div><label class="c-checkbox"><input type="checkbox" id="clash-udp" name="udp"><span>启用 UDP <small>需代理服务支持</small></span></label></div>
<p class="c-privacy">生成订阅会将配置加密保存到本站 ${SUBSCRIPTION_DAYS} 天。持有链接的人可读取代理凭据，请妥善保管。下载 YAML 仅在本机处理。</p>
<div class="c-actions"><button class="c-button c-button--primary" type="submit" id="clash-generate">生成订阅链接</button><button class="c-button" type="button" id="clash-download">下载 YAML</button></div>
</fieldset>
<p class="c-error" id="clash-error" role="alert" hidden></p>
<p class="c-feedback" id="clash-feedback" role="status" aria-live="polite"></p>
</form>
</section>
<section class="c-output" aria-labelledby="clash-output-title">
<div class="c-panel-head"><h2 id="clash-output-title">Clash 配置</h2><span class="c-state" id="clash-count">等待转换</span></div>
<div id="clash-subscription" class="c-subscription" hidden>
<label for="clash-url" id="clash-url-label">订阅链接</label><input id="clash-url" type="text" readonly spellcheck="false" autocomplete="off">
<div class="c-actions"><button class="c-button c-button--small" type="button" id="clash-copy-url">复制链接</button><a class="c-button c-button--small" id="clash-import">导入 Clash Verge</a><button class="c-text-button c-revoke" id="clash-revoke" type="button">使链接失效</button></div>
<p class="c-hint" id="clash-expiry"></p><p class="c-hint">这是生成时的配置快照。修改代理后需生成新链接；关闭页面后，原链接仍有效至到期。</p>
</div>
<div class="c-preview-head"><span>YAML 预览</span><button type="button" class="c-text-button" id="clash-copy-yaml" disabled>复制配置</button></div>
<pre class="c-code" tabindex="0" aria-label="YAML 配置预览"><code id="clash-yaml"># 在左侧填入 SOCKS5 代理信息
# 生成订阅或下载文件后，将在这里预览配置
# 预览包含代理凭据，请勿截图分享</code></pre>
</section>
</div>
<section class="c-instructions" id="instructions" aria-labelledby="instructions-title"><div><h2 id="instructions-title">在客户端中使用</h2><p>Clash 输出完整 YAML 配置；小火箭输出 YAML 节点列表。两种格式均通过本站私密链接拉取。</p></div>
<ol><li><strong>填写代理并选择客户端</strong><p>支持带账号密码或无需认证的代理。“填入示例”使用文档保留地址，仅用于演示格式。</p></li><li><strong>生成并导入订阅链接</strong><p>Clash Verge：在“订阅”页粘贴链接后导入。小火箭：点右上角“+”，类型选择“Subscribe / 订阅”，在 URL 中粘贴链接并保存。也可以使用页面上的客户端导入按钮。</p></li><li><strong>选择节点并连接</strong><p>Clash 在 PROXY 分组选择节点，开启系统代理或 TUN；选择 DIRECT 则直连。小火箭选中新增订阅内的节点，再按自己的路由配置连接。节点订阅不会替换小火箭原有分流规则。</p></li></ol>
</section>
<div class="c-notes"><details><summary>只有 YAML 文件，怎么导入？</summary><p>Clash Verge 可在“订阅”页面新建本地配置并选择下载的 YAML 文件。小火箭建议选择对应客户端后生成链接，以 Subscribe 类型导入。静态预览没有订阅 API 时仍能下载配置。</p></details><details><summary>订阅链接和代理连接有什么区别？</summary><p>订阅链接用于下载代理配置。转换不会检测代理连通性、改变 IP 所属地区或延长代理有效期；实际连接和 UDP 转发取决于代理服务本身。</p></details><details><summary>如何更新或删除订阅？</summary><p>修改代理信息后重新生成链接，再导入客户端。当前页面可使用“使链接失效”立即删除对应订阅；配置会在 ${SUBSCRIPTION_DAYS} 天后自动失效。失效不会删除客户端已经下载的配置。</p></details></div>
</main>`;
