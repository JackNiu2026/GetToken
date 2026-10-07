// Scroll and pointer motion. Content is readable without any of this running.

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/* One rAF-throttled scroll/resize bus shared by every scroll-linked effect. */
const scrollJobs = new Set();
let scheduled = false;
function runScrollJobs() {
  scheduled = false;
  for (const job of scrollJobs) job();
}
function requestScrollJobs() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(runScrollJobs);
}
window.addEventListener('scroll', requestScrollJobs, { passive: true });
window.addEventListener('resize', requestScrollJobs);
export function onScroll(job) {
  scrollJobs.add(job);
  requestScrollJobs();
}

/* Split headings into masked characters. */
export function initSplit(root = document) {
  const groups = new Map();
  root.querySelectorAll('[data-split]').forEach(element => {
    const offset = groups.get(element.parentElement) || 0;
    const text = element.textContent;
    element.setAttribute('aria-label', text);
    element.textContent = '';
    let index = 0;
    for (const ch of text) {
      if (ch === ' ') { element.append(' '); continue; }
      const wrap = document.createElement('span');
      wrap.className = 'char-wrap';
      wrap.setAttribute('aria-hidden', 'true');
      const span = document.createElement('span');
      span.className = 'char';
      span.style.setProperty('--i', String(offset + index));
      span.textContent = ch;
      wrap.append(span);
      element.append(wrap);
      index += 1;
    }
    groups.set(element.parentElement, offset + index);
    element.style.position = 'relative';
    element.classList.add('is-split');
  });
  layoutSplitGradients(root);
  window.addEventListener('resize', () => layoutSplitGradients(root));
}

// Give each char its slice of one gradient spanning the whole line.
function layoutSplitGradients(root) {
  root.querySelectorAll('.is-split.line--grad').forEach(element => {
    const width = element.scrollWidth;
    element.style.setProperty('--w', `${width}px`);
    element.querySelectorAll('.char').forEach(char => {
      char.style.setProperty('--x', `${char.parentElement.offsetLeft}px`);
    });
  });
}

/* Reveal on enter, staggering items that arrive together. */
export function initReveal(root = document) {
  const targets = root.querySelectorAll('[data-reveal], [data-split]');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(t => t.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    const entering = entries.filter(e => e.isIntersecting).map(e => e.target);
    entering.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    entering.forEach((target, i) => {
      if (!target.style.getPropertyValue('--delay')) target.style.setProperty('--delay', `${Math.min(i, 6) * 0.08}s`);
      target.classList.add('is-in');
      observer.unobserve(target);
      target.dispatchEvent(new CustomEvent('reveal'));
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  targets.forEach(t => observer.observe(t));
}

/* Count numbers up when revealed. */
export function initCounters(root = document) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count);
    const host = el.closest('[data-reveal]') || el;
    const run = () => {
      if (reduceMotion.matches) return;
      const start = performance.now();
      const dur = 1400;
      const tick = now => {
        const p = clamp((now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 4);
        el.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(tick);
      };
      el.textContent = '0';
      requestAnimationFrame(tick);
    };
    host.addEventListener('reveal', run, { once: true });
  });
}

/* Buttons that lean toward the cursor. */
export function initMagnetic(root = document) {
  if (!finePointer.matches || reduceMotion.matches) return;
  root.querySelectorAll('[data-magnetic]').forEach(el => {
    el.addEventListener('pointermove', event => {
      const r = el.getBoundingClientRect();
      const x = event.clientX - (r.left + r.width / 2);
      const y = event.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * 0.22}px, ${y * 0.32}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/* Cursor spotlight on cards, plus a slight 3D tilt on pricing cards. */
export function initSpotlight(root = document) {
  if (!finePointer.matches) return;
  root.querySelectorAll('[data-spot], [data-tilt]').forEach(el => {
    const tilt = el.hasAttribute('data-tilt') && !reduceMotion.matches;
    el.addEventListener('pointermove', event => {
      const r = el.getBoundingClientRect();
      const px = (event.clientX - r.left) / r.width;
      const py = (event.clientY - r.top) / r.height;
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
      if (tilt) {
        el.style.setProperty('--rx', `${(0.5 - py) * 4}deg`);
        el.style.setProperty('--ry', `${(px - 0.5) * 5}deg`);
      }
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  });
}

/* Page progress bar + header state. */
export function initChrome({ bar, header }) {
  onScroll(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--progress', String(max > 0 ? clamp(window.scrollY / max) : 0));
    header.classList.toggle('is-scrolled', window.scrollY > 12);
  });
}

/* The product console flattens from a tilted plane as it scrolls into view. */
export function initConsoleTilt(consoleEl, stage) {
  if (!consoleEl || reduceMotion.matches) return;
  onScroll(() => {
    const r = stage.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = clamp((vh - r.top) / (vh * 0.75));
    consoleEl.style.setProperty('--tilt', `${16 * (1 - p)}deg`);
    consoleEl.style.setProperty('--scale', String(0.94 + 0.06 * p));
    consoleEl.style.setProperty('--lift', `${(1 - p) * 30}px`);
  });
}

/* Steps: draw the connecting line and light each step as it is reached. */
export function initSteps(list) {
  if (!list) return;
  const items = Array.from(list.children);
  onScroll(() => {
    const r = list.getBoundingClientRect();
    const p = clamp((window.innerHeight * 0.7 - r.top) / (r.height + window.innerHeight * 0.15));
    list.style.setProperty('--steps', String(p));
    items.forEach((item, i) => item.classList.toggle('is-lit', p >= (i / items.length) + 0.02 || reduceMotion.matches));
  });
}
