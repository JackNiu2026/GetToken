import { $, $$, onBeforeDialog, openDialog } from './shop.mjs';
import {
  onScroll, initSplit, initReveal, initCounters, initChrome, initSteps,
} from './motion.mjs';
import { initEarth } from './scenes.mjs';

// Everything here is page-local: no requests, no storage, no real orders.
// Pricing and payment live on the product pages; the homepage keeps the contact dialog.
const header = $('.site-header');
const menuToggle = $('.menu-toggle');
const mobileNav = $('#mobile-nav');
const drawerViewport = window.matchMedia('(max-width: 960px)');
const mobileViewport = window.matchMedia('(max-width: 640px)');

/* ---------- Navigation ---------- */
function closeMenu() {
  mobileNav.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '打开菜单');
}
menuToggle.addEventListener('click', () => {
  const open = mobileNav.hidden;
  mobileNav.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
});
$$('a', mobileNav).forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!mobileNav.hidden) {
    closeMenu();
    menuToggle.focus();
  }
});
drawerViewport.addEventListener('change', () => { if (!drawerViewport.matches) closeMenu(); });

onBeforeDialog(closeMenu);

// Other pages link 联系客服 to /#contact; open the customer-service dialog when they land here.
function openContactFromHash() {
  if (location.hash !== '#contact') return;
  const dialog = $('#query-dialog');
  if (dialog && !dialog.open) openDialog(dialog, $('[data-open-query]'));
  history.replaceState(null, '', location.pathname + location.search);
}
window.addEventListener('hashchange', openContactFromHash);
openContactFromHash();

/* ---------- Mobile buy bar ---------- */
function initBuyBar() {
  const bar = $('#buy-bar');
  const hero = $('.hero');
  const products = $('#products');
  let productsVisible = false;
  new IntersectionObserver(([entry]) => {
    productsVisible = entry.isIntersecting;
    update();
  }, { threshold: 0.05 }).observe(products);
  function update() {
    const pastHero = window.scrollY > hero.offsetTop + hero.offsetHeight - 120;
    const show = mobileViewport.matches && pastHero && !productsVisible;
    bar.hidden = !show;
    document.body.classList.toggle('has-buy-bar', show);
  }
  onScroll(update);
}

/* ---------- Boot ---------- */
initSplit();
initReveal();
initCounters();
initChrome({ bar: $('.scroll-progress'), header });
initSteps($('[data-steps]'));
initBuyBar();

const horizon = $('[data-horizon]');
if (horizon) initEarth(horizon, { anchor: $('[data-horizon-anchor]'), hero: $('.hero') });

document.documentElement.classList.add('motion-ready');
