// Reference-style option buttons; original select remains the single data source.
export function enhanceSelect(select) {
  const owner = select.ownerDocument;
  const label = owner.querySelector(`label[for="${select.id}"]`);
  const group = owner.createElement('div');
  group.className = 'option-chips';
  group.setAttribute('role', 'group');
  if (label) {
    if (!label.id) label.id = `${select.id}-label`;
    group.setAttribute('aria-labelledby', label.id);
  }

  const buttons = Array.from(select.options, option => {
    const button = owner.createElement('button');
    button.type = 'button';
    button.className = 'option-chip';
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.disabled = option.disabled;
    button.setAttribute('aria-pressed', String(select.value === option.value));
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    group.append(button);
    return button;
  });

  const synchronize = () => buttons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.value === select.value));
  });
  select.addEventListener('change', synchronize);
  select.after(group);
  // Hide only after the usable replacement exists; no-JS users retain the select.
  select.hidden = true;
  label?.addEventListener('click', () => {
    buttons.find(button => button.dataset.value === select.value)?.focus();
  });
  return group;
}

// Dark on-page dropdown matching the reference; no duplicated business values.
export function enhanceDropdown(select) {
  const owner = select.ownerDocument;
  const label = owner.querySelector(`label[for="${select.id}"]`);
  if (label && !label.id) label.id = `${select.id}-label`;
  const dropdown = owner.createElement('details');
  dropdown.className = 'choice-dropdown';
  const trigger = owner.createElement('summary');
  trigger.className = 'choice-trigger';
  trigger.id = `${select.id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const value = owner.createElement('span');
  value.id = `${select.id}-value`;
  if (label) trigger.setAttribute('aria-labelledby', `${label.id} ${value.id}`);
  trigger.append(value);
  const list = owner.createElement('div');
  list.className = 'choice-options';
  list.id = `${select.id}-options`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', label?.id || trigger.id);
  trigger.setAttribute('aria-controls', list.id);
  const buttons = Array.from(select.options, option => {
    const button = owner.createElement('button');
    button.type = 'button';
    button.className = 'choice-option';
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.disabled = option.disabled;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(option.selected));
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      dropdown.open = false;
      trigger.focus({ preventScroll: true });
    });
    list.append(button);
    return button;
  });
  const sync = () => {
    value.textContent = select.selectedOptions[0]?.textContent || '';
    buttons.forEach(button => button.setAttribute('aria-selected', String(button.dataset.value === select.value)));
  };
  sync();
  dropdown.append(trigger, list);
  select.after(dropdown);
  select.hidden = true;
  select.addEventListener('change', sync);
  label?.addEventListener('click', () => trigger.focus());
  dropdown.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(dropdown.open)));
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    dropdown.open = true;
    const current = buttons.find(button => button.dataset.value === select.value);
    current?.focus();
  });
  dropdown.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dropdown.open = false;
      trigger.focus();
    }
    const index = buttons.indexOf(owner.activeElement);
    if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (index + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  owner.addEventListener('click', event => {
    if (!dropdown.contains(event.target)) dropdown.open = false;
  });
  dropdown.addEventListener('focusout', event => {
    if (event.relatedTarget && !dropdown.contains(event.relatedTarget)) dropdown.open = false;
  });
  return dropdown;
}
