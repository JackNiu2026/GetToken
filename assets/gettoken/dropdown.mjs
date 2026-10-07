// Custom listbox over a native <select>. The select stays the single source of
// truth (and the no-JS fallback); this only replaces how it looks and is driven.

const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.3 2.8 2.7 6.2-6.4"/></svg>';
const open = new Set();

document.addEventListener('pointerdown', event => {
  for (const dropdown of open) if (!dropdown.root.contains(event.target)) dropdown.close();
});

export function enhanceDropdown(select) {
  const doc = select.ownerDocument;
  const labelId = select.getAttribute('aria-labelledby');
  const root = doc.createElement('div');
  root.className = 'dropdown';

  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dropdown__trigger';
  trigger.id = `${select.id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const value = doc.createElement('span');
  value.className = 'dropdown__value';
  value.id = `${select.id}-value`;
  trigger.setAttribute('aria-labelledby', `${labelId} ${value.id}`);
  trigger.append(value);
  trigger.insertAdjacentHTML('beforeend', CHEVRON);

  const list = doc.createElement('ul');
  list.className = 'dropdown__list';
  list.id = `${select.id}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', labelId);
  list.tabIndex = -1;
  trigger.setAttribute('aria-controls', list.id);

  const options = Array.from(select.options, (option, index) => {
    const item = doc.createElement('li');
    item.className = 'dropdown__option';
    item.id = `${select.id}-opt-${index}`;
    item.setAttribute('role', 'option');
    item.dataset.index = String(index);
    item.textContent = option.textContent;
    item.insertAdjacentHTML('beforeend', CHECK);
    list.append(item);
    return item;
  });

  let active = select.selectedIndex;
  const setActive = index => {
    active = (index + options.length) % options.length;
    options.forEach((item, i) => item.classList.toggle('is-active', i === active));
    list.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({ block: 'nearest' });
  };
  const sync = () => {
    value.textContent = select.selectedOptions[0]?.textContent || '';
    options.forEach((item, i) => item.setAttribute('aria-selected', String(i === select.selectedIndex)));
  };

  const api = {
    root,
    open() {
      if (root.classList.contains('is-open')) return;
      for (const other of open) other.close();
      open.add(api);
      root.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      setActive(select.selectedIndex);
      list.focus({ preventScroll: true });
    },
    close({ focus = false } = {}) {
      if (!root.classList.contains('is-open')) return;
      open.delete(api);
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus({ preventScroll: true });
    },
  };

  const choose = index => {
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    api.close({ focus: true });
  };

  trigger.addEventListener('click', () => (root.classList.contains('is-open') ? api.close() : api.open()));
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      api.open();
    }
  });
  list.addEventListener('keydown', event => {
    const keys = { ArrowDown: () => setActive(active + 1), ArrowUp: () => setActive(active - 1), Home: () => setActive(0), End: () => setActive(options.length - 1) };
    if (keys[event.key]) {
      event.preventDefault();
      keys[event.key]();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      api.close({ focus: true });
    } else if (event.key === 'Tab') {
      api.close();
    }
  });
  list.addEventListener('pointermove', event => {
    const item = event.target.closest('.dropdown__option');
    if (item) setActive(Number(item.dataset.index));
  });
  list.addEventListener('click', event => {
    const item = event.target.closest('.dropdown__option');
    if (item) choose(Number(item.dataset.index));
  });
  root.addEventListener('focusout', event => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) api.close();
  });
  select.addEventListener('change', sync);

  sync();
  root.append(trigger, list);
  select.after(root);
  select.hidden = true;
  doc.getElementById(labelId)?.addEventListener('click', () => trigger.focus());
  return api;
}
