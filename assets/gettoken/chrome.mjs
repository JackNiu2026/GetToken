// Shared header behaviour on generated pages (products, /verify/, /guides/): the phone menu, the
// product menu and the scrolled state. The homepage does the same in home.mjs.
const header = document.querySelector('.site-header');
const toggle = header?.querySelector('.menu-toggle');
const menu = document.getElementById('mobile-nav');
const products = header?.querySelector('.nav-products');

function closeMenu() {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', '打开菜单');
}

if (header && toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  });
  menu.addEventListener('click', event => { if (event.target.closest('a, button')) closeMenu(); });
  document.addEventListener('click', event => {
    if (products && !products.contains(event.target)) products.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (products?.open) {
      products.open = false;
      products.querySelector('summary').focus();
    }
    if (!menu.hidden) {
      closeMenu();
      toggle.focus();
    }
  });
  window.matchMedia('(max-width: 960px)').addEventListener('change', event => { if (!event.matches) closeMenu(); });
  const scrolled = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  window.addEventListener('scroll', scrolled, { passive: true });
  scrolled();
}
