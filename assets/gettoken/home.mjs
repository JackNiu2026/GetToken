import { $, $$, onBeforeDialog, openDialog } from './shop.mjs';
import {
  onScroll, initSplit, initReveal, initCounters, initChrome,
  initConsoleTilt, initSteps, reduceMotion,
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

/* ---------- Hero product console ---------- */
function initConsole(root) {
  if (!root) return;
  const tabs = $$('[role="tab"]', root);
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const cycle = 6000;
  root.style.setProperty('--cycle', `${cycle}ms`);
  let index = 0;
  let timer = 0;
  let typeTimers = [];
  let inView = true;

  function type(panel) {
    typeTimers.forEach(clearTimeout);
    typeTimers = [];
    const typer = $('[data-typer]', panel);
    if (!typer || reduceMotion.matches) return;
    const items = Array.from(typer.children);
    typer.classList.add('is-typing');
    items.forEach(item => item.classList.remove('is-typed'));
    items.forEach((item, i) => {
      typeTimers.push(setTimeout(() => item.classList.add('is-typed'), 250 + i * 420));
    });
  }

  function select(i, { focus = false } = {}) {
    index = (i + tabs.length) % tabs.length;
    tabs.forEach((tab, k) => {
      const on = k === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
      panels[k].classList.toggle('is-active', on);
    });
    if (focus) tabs[index].focus();
    type(panels[index]);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (reduceMotion.matches || root.hasAttribute('data-paused') || !inView) return;
    timer = setTimeout(() => select(index + 1), cycle);
  }

  const pause = () => { root.setAttribute('data-paused', ''); clearTimeout(timer); };
  const resume = () => { root.removeAttribute('data-paused'); select(index); };
  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i)));
  root.addEventListener('keydown', event => {
    if (!event.target.matches('[role="tab"]')) return;
    if (event.key === 'ArrowRight') select(index + 1, { focus: true });
    if (event.key === 'ArrowLeft') select(index - 1, { focus: true });
  });
  root.addEventListener('pointerenter', pause);
  root.addEventListener('pointerleave', resume);
  root.addEventListener('focusin', pause);
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) resume(); });
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    schedule();
  }).observe(root);
  select(0);
}

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
initConsole($('[data-console]'));
initConsoleTilt($('[data-console]'), $('[data-stage]'));
initSteps($('[data-steps]'));
initBuyBar();

const horizon = $('[data-horizon]');
if (horizon) initEarth(horizon, { anchor: $('[data-horizon-anchor]'), hero: $('.hero') });

document.documentElement.classList.add('motion-ready');
