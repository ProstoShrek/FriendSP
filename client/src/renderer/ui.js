// Мелкие помощники для интерфейса без фреймворков.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(markup, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${markup}</svg>`;
  return t.content.firstChild;
}

export const icons = {
  all: '<path fill="currentColor" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  star: '<path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/>',
  user: '<path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z"/>',
  search: '<path fill="none" stroke="currentColor" stroke-width="2" d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21"/>',
  gear: '<path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>',
  mic: '<path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15zm6-3.5a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.9V22h2v-2.6a8 8 0 0 0 7-7.9z"/>',
  micOff: '<path fill="currentColor" d="M15.5 10.4V5.5a3.5 3.5 0 0 0-6.9-.8zM4.3 3L3 4.3l5.5 5.5v1.7a3.5 3.5 0 0 0 5.2 3.1l1.5 1.5A6 6 0 0 1 6 11.5H4a8 8 0 0 0 7 7.9V22h2v-2.6a7.9 7.9 0 0 0 3.7-1.5l3 3 1.3-1.3zM18 11.5a6 6 0 0 1-.5 2.4l1.5 1.5a8 8 0 0 0 1-3.9z"/>',
  headphones: '<path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2v-7H5v-2a7 7 0 0 1 14 0v2h-2v7h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z"/>',
  discord: '<path fill="currentColor" d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7A16.7 16.7 0 0 0 6.8 19.3l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3a10.8 10.8 0 0 1-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5.1-2.6c.4-4.3-.7-8-3-11.4zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  upload: '<path fill="currentColor" d="M11 16V7.8l-3.6 3.6L6 10l6-6 6 6-1.4 1.4L13 7.8V16zM5 18h14v2H5z"/>',
  shield: '<path fill="currentColor" d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm-1 13.6l6-6-1.4-1.4-4.6 4.6-2.1-2.1L7.5 12z"/>',
  folder: '<path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  server: '<path fill="currentColor" d="M4 4h16v6H4zm0 10h16v6H4zm3-8.5v3h2v-3zm0 10v3h2v-3z"/>',
  ticket: '<path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4zm9 0v2h2V7zm0 4v2h2v-2zm0 4v2h2v-2z"/>',
  users: '<path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7.5 0a3 3 0 1 0 0-6M9 13c-4 0-7 2-7 4.5V20h14v-2.5C16 15 13 13 9 13zm7.5 0c-.6 0-1.1 0-1.6.1 1.3 1 2.1 2.4 2.1 4.4V20h5v-2.5c0-2.5-2.6-4.5-5.5-4.5z"/>',
  keyboard: '<path fill="currentColor" d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm2 3v2h2V9zm4 0v2h2V9zm4 0v2h2V9zm4 0v2h2V9zM5 13v2h2v-2zm4 0v2h6v-2zm8 0v2h2v-2z"/>',
  speaker: '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>',
  close: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>',
  plus: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/>',
};

export const icon = (name, cls) => svg(icons[name], cls);

export function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/** Модальное окно. Возвращает { el, close }. */
export function modal(content, { wide = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}` }, content);
  const backdrop = h('div', { class: 'backdrop' }, box);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.hotkey-capture.listening')) { e.stopPropagation(); close(); }
  };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  root.append(backdrop);
  return { el: box, close };
}

export function confirmDialog({ title, text, ok = 'Удалить', danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal([
      h('div', { class: 'modal-head' }, h('div', {}, h('h2', {}, title), h('p', {}, text))),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'),
        h('button', { class: `btn ${danger ? 'danger' : ''}`, onclick: () => { result = true; m.close(); } }, ok)),
    ], { onClose: () => resolve(result) });
  });
}

let openMenu = null;
export function contextMenu(x, y, items) {
  openMenu?.remove();
  const menu = h('div', { class: 'ctx-menu' }, items.map((it) => {
    if (it === '-') return h('hr');
    return h('button', {
      class: it.danger ? 'danger' : '',
      onclick: () => { menu.remove(); openMenu = null; it.action(); },
    }, h('span', {}, it.label), it.hint ? h('span', { class: 'kbd' }, it.hint) : null);
  }));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  openMenu = menu;
  const away = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', away, true);
  };
  setTimeout(() => document.addEventListener('mousedown', away, true));
}

export function rangeFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function initials(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

let avatarBase = '';
/** Адрес сервера, с которого грузятся картинки аватарок. */
export function setAvatarBase(url) { avatarBase = url; }
export const avatarUrl = (file) => (file ? `${avatarBase}/api/avatars/${encodeURIComponent(file)}` : null);

export function avatar(user, { size = '', online = false } = {}) {
  const url = avatarUrl(user.avatar);
  // Без своей картинки — нейтральный серый силуэт
  return h('div', { class: `avatar ${size} ${url ? '' : 'default'}` },
    url ? h('img', { src: url, alt: '', draggable: false }) : svg('<circle cx="12" cy="9" r="4" fill="currentColor"/><path d="M4.5 20c.8-3.6 3.9-6 7.5-6s6.7 2.4 7.5 6z" fill="currentColor"/>', 'avatar-default'),
    online ? h('span', { class: 'dot' }) : null);
}

// ---------- Горячие клавиши в формате Electron ----------

const CODE_MAP = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

/** keydown -> "Ctrl+Alt+K" или null, если сочетание не подходит. */
export function accelFromEvent(e) {
  const code = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (/^Numpad\d$/.test(code)) key = `num${code.slice(6)}`;
  else if (CODE_MAP[code]) key = CODE_MAP[code];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  // Без модификатора разрешаем только F-клавиши и цифровой блок, чтобы не ломать набор текста в игре
  if (!mods.length && !/^F\d|^num/.test(key)) return null;
  return [...mods, key].join('+');
}

export function prettyAccel(accel) {
  return (accel || '').replace(/^num/, 'Num ').replace(/\+num/, '+Num ');
}
