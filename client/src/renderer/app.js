import { AudioEngine } from './audio.js';
import {
  h, icon, toast, modal, confirmDialog, contextMenu, rangeFill, fmtSize, avatar,
  accelFromEvent, prettyAccel,
} from './ui.js';
import { openAdmin } from './admin.js';
import { openUpload } from './upload.js';

const native = window.native;
const $app = document.getElementById('app');

// ---------- Состояние ----------

export const state = {
  settings: {},
  user: null,
  sounds: [],
  version: 0,
  online: [],
  view: 'all',          // all | fav | mine | cat:<имя>
  search: '',
  syncing: false,
  connected: false,
  missingCable: false,
};

const engine = new AudioEngine();
let ws = null;
let wsRetry = 0;
let wsTimer = null;

const DEFAULTS = {
  serverUrl: '',
  monitorDevice: '',
  cableDevice: null,     // null = ещё не выбирали, попробуем найти VB-Cable
  micDevice: 'default',
  micEnabled: true,
  monitorVolume: 0.5,
  cableVolume: 0.8,
  micVolume: 1,
  overlap: true,
  hotkeys: {},           // soundId -> accel
  stopHotkey: 'Ctrl+Alt+0',
  favorites: [],
  showMembers: true,
};

export async function saveSettings(patch) {
  state.settings = await native.setSettings(patch);
  return state.settings;
}

const S = (k) => state.settings[k] ?? DEFAULTS[k];

// ---------- API ----------

export async function api(method, path, body) {
  const res = await fetch(`${S('serverUrl')}${path}`, {
    method,
    headers: {
      ...(state.settings.token ? { authorization: `Bearer ${state.settings.token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) {
    logout(true);
    throw new Error('Сессия закончилась, войди заново');
  }
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

function normalizeUrl(url) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  // Порт по умолчанию, если указан только адрес
  try {
    const parsed = new URL(u);
    if (!parsed.port && parsed.protocol === 'http:' && !/[a-z]/i.test(parsed.hostname.replace(/localhost/, '1'))) parsed.port = '8787';
    u = parsed.origin;
  } catch { /* оставим как есть, ошибка всплывёт при подключении */ }
  return u;
}

// ---------- Запуск ----------

async function boot() {
  state.settings = await native.getSettings();
  document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => native[b.dataset.win]()));

  if (state.settings.token && S('serverUrl')) {
    try {
      const { user } = await api('GET', '/api/me');
      state.user = user;
      return enterApp();
    } catch (e) {
      // Сервер недоступен: всё равно пускаем, играть можно из кэша
      if (state.settings.user && !/Сессия/.test(e.message)) {
        state.user = state.settings.user;
        return enterApp();
      }
    }
  }
  renderAuth();
}

// ---------- Экран входа ----------

async function renderAuth(mode = 'login') {
  $app.replaceChildren();
  let info = null;
  const err = h('div', { class: 'error-text' });
  const server = h('input', { class: 'input', placeholder: '192.168.1.10:8787 или sound.example.ru', value: S('serverUrl').replace(/^http:\/\//, '') });
  const username = h('input', { class: 'input', autocomplete: 'username', value: state.settings.user?.username ?? '' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const invite = h('input', { class: 'input', placeholder: 'XXXX-XXXX', style: { textTransform: 'uppercase' } });
  const inviteField = h('div', { class: 'field' }, h('label', { class: 'label' }, 'Инвайт-код ', h('span', { class: 'req' }, '*')), invite,
    h('div', { class: 'hint' }, 'Попроси код у админа сервера.'));
  const submit = h('button', { class: 'btn block', type: 'submit' }, mode === 'login' ? 'Войти' : 'Создать аккаунт');

  const checkServer = async () => {
    if (!server.value.trim()) return;
    try {
      const url = normalizeUrl(server.value);
      const res = await fetch(`${url}/api/info`);
      info = await res.json();
      inviteField.style.display = mode === 'register' && !info.needsSetup ? '' : 'none';
      if (info.needsSetup && mode === 'login') {
        err.textContent = 'На сервере ещё нет аккаунтов — зарегистрируйся, ты станешь админом.';
      }
    } catch { info = null; }
  };
  server.addEventListener('change', checkServer);
  inviteField.style.display = mode === 'register' ? '' : 'none';

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        const url = normalizeUrl(server.value);
        await saveSettings({ serverUrl: url });
        const body = { username: username.value.trim(), password: password.value };
        if (mode === 'register') body.invite = invite.value.trim();
        const data = await api('POST', mode === 'login' ? '/api/login' : '/api/register', body);
        await saveSettings({ token: data.token, user: data.user });
        state.user = data.user;
        if (data.user.isAdmin && mode === 'register' && info?.needsSetup) toast('Ты первый — теперь ты админ сервера 👑', 'ok');
        enterApp();
      } catch (ex) {
        err.textContent = ex.message === 'Failed to fetch' ? 'Сервер не отвечает. Проверь адрес и что он запущен.' : ex.message;
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('div', { class: 'field' }, h('label', { class: 'label' }, 'Адрес сервера ', h('span', { class: 'req' }, '*')), server),
  h('div', { class: 'field' }, h('label', { class: 'label' }, 'Ник ', h('span', { class: 'req' }, '*')), username),
  h('div', { class: 'field' }, h('label', { class: 'label' }, 'Пароль ', h('span', { class: 'req' }, '*')), password),
  inviteField,
  submit,
  err,
  h('div', { class: 'auth-switch' },
    mode === 'login'
      ? ['Нужен аккаунт? ', h('button', { type: 'button', class: 'link', onclick: () => renderAuth('register') }, 'Зарегистрироваться')]
      : ['Уже есть аккаунт? ', h('button', { type: 'button', class: 'link', onclick: () => renderAuth('login') }, 'Войти')]));

  $app.append(h('div', { class: 'auth-screen' }, h('div', { class: 'auth-card' },
    h('h1', {}, mode === 'login' ? 'С возвращением!' : 'Создать аккаунт'),
    h('p', { class: 'sub' }, mode === 'login' ? 'Рады снова тебя слышать 🔊' : 'Общая коллекция звуков для вашей компании'),
    form)));
  (server.value ? (state.settings.user ? password : username) : server).focus();
  checkServer();
}

export async function logout(expired = false) {
  if (!expired) await api('POST', '/api/logout').catch(() => {});
  ws?.close();
  ws = null;
  clearTimeout(wsTimer);
  engine.stopAll();
  state.user = null;
  await saveSettings({ token: null });
  renderAuth();
}

// ---------- Основной экран ----------

async function enterApp() {
  renderShell();
  api('GET', '/api/info').then((info) => { state.serverInfo = info; }).catch(() => {});
  await applyAudio().catch((e) => toast(`Аудио: ${e.message}`, 'error'));
  applyHotkeys();
  connectWs();
  await refresh();
}

export async function applyAudio() {
  // При первом запуске пробуем сами найти VB-Cable
  if (state.settings.cableDevice == null) {
    const { outputs } = await engine.listDevices();
    const guess = AudioEngine.guessCable(outputs);
    await saveSettings({ cableDevice: guess });
  }
  await engine.configure({
    monitorDevice: S('monitorDevice'),
    cableDevice: S('cableDevice'),
    monitorVolume: S('monitorVolume'),
    cableVolume: S('cableVolume'),
    micDevice: S('micDevice'),
    micEnabled: S('micEnabled'),
    micVolume: S('micVolume'),
    overlap: S('overlap'),
  });
  state.missingCable = !S('cableDevice');
  renderPlayerBar();
  renderUserPanel();
}

export async function applyHotkeys() {
  const map = {};
  if (S('stopHotkey')) map[S('stopHotkey')] = 'stop';
  for (const [id, accel] of Object.entries(S('hotkeys'))) if (accel) map[accel] = `sound:${id}`;
  const { failed } = await native.setHotkeys(map);
  if (failed.length) toast(`Не удалось занять: ${failed.map(prettyAccel).join(', ')} (занято другой программой?)`, 'error');
}

native.onHotkey((action) => {
  if (action === 'stop') return engine.stopAll();
  const id = Number(action.split(':')[1]);
  const s = state.sounds.find((x) => x.id === id);
  if (s) play(s);
});

export async function refresh() {
  if (!state.user) return;
  state.syncing = true;
  renderSyncState();
  try {
    const data = await api('GET', '/api/sounds');
    state.sounds = data.sounds;
    state.version = data.version;
    await saveSettings({ soundsCache: data.sounds });
    renderSidebar();
    renderGrid();
    const r = await native.syncCache({ server: S('serverUrl'), token: state.settings.token, sounds: data.sounds });
    if (r.errors.length) toast(`Не скачалось звуков: ${r.errors.length}`, 'error');
    engine.forget(new Set(data.sounds.map((s) => s.hash)));
  } catch (e) {
    // Офлайн: показываем то, что было в кэше
    if (!state.sounds.length && state.settings.soundsCache) state.sounds = state.settings.soundsCache;
    if (e.message !== 'Failed to fetch') toast(e.message, 'error');
  } finally {
    state.syncing = false;
    renderSyncState();
    renderSidebar();
    renderGrid();
  }
}

function connectWs() {
  clearTimeout(wsTimer);
  const url = `${S('serverUrl').replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(state.settings.token)}`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    wsRetry = 0;
    state.connected = true;
    renderSyncState();
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'hello' || msg.type === 'sounds') {
      if (msg.version !== state.version) refresh();
    } else if (msg.type === 'presence') {
      state.online = msg.users;
      renderMembers();
    } else if (msg.type === 'users') {
      document.dispatchEvent(new CustomEvent('users-changed'));
    }
  };
  ws.onclose = (ev) => {
    state.connected = false;
    state.online = [];
    renderSyncState();
    renderMembers();
    if (ev.code === 4001) return logout(true);
    if (!state.user) return;
    // Переподключение с нарастающей паузой: 1, 2, 4 … 30 секунд
    const delay = Math.min(30000, 1000 * 2 ** wsRetry++);
    wsTimer = setTimeout(connectWs, delay);
  };
}

// ---------- Проигрывание ----------

export function play(sound) {
  engine.play(sound, native.readSound).catch((e) => toast(`Не удалось сыграть «${sound.name}»: ${e.message}`, 'error'));
}

engine.onChange = () => {
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('playing', engine.isPlaying(Number(t.dataset.id))));
  renderNowPlaying();
  if (engine.playing.size) requestAnimationFrame(animateBars);
};

function animateBars() {
  document.querySelectorAll('.tile.playing').forEach((t) => {
    t.querySelector('.bar').style.transform = `scaleX(${engine.progress(Number(t.dataset.id))})`;
  });
  document.querySelectorAll('.tile:not(.playing) .bar').forEach((b) => { b.style.transform = 'scaleX(0)'; });
  if (engine.playing.size) requestAnimationFrame(animateBars);
}

// ---------- Отрисовка ----------

let els = {};

function renderShell() {
  els = {
    sidebar: h('aside', { class: 'sidebar' }),
    main: h('main', { class: 'main' }),
    members: h('aside', { class: 'members' }),
  };
  $app.replaceChildren(els.sidebar, els.main);

  els.syncState = h('div', { class: 'sync-state' });
  els.nav = h('nav', { class: 'nav' });
  els.userPanel = h('div', { class: 'user-panel' });
  els.sidebar.append(
    h('div', { class: 'sidebar-header' }, h('span', {}, 'Звуки'), els.syncState),
    els.nav,
    els.userPanel,
  );

  els.title = h('div', { class: 'title' });
  const search = h('input', {
    class: 'input', placeholder: 'Поиск', value: state.search,
    oninput: (e) => { state.search = e.target.value; renderGrid(); },
    onkeydown: (e) => { if (e.key === 'Escape') { e.target.value = ''; state.search = ''; renderGrid(); } },
  });
  els.search = search;
  const uploadBtn = h('button', { class: 'icon-btn', title: 'Загрузить звуки', onclick: () => openUpload() }, icon('upload'));
  els.membersBtn = h('button', {
    class: `icon-btn ${S('showMembers') ? 'active' : ''}`, title: 'Кто в сети',
    onclick: async () => { await saveSettings({ showMembers: !S('showMembers') }); renderMembers(); },
  }, icon('users'));
  els.adminBtn = h('button', { class: 'icon-btn', title: 'Админка', onclick: () => openAdmin() }, icon('shield'));

  els.gridWrap = h('div', { class: 'grid-wrap' });
  els.content = h('div', { class: 'content' }, els.gridWrap, els.members);
  els.playerBar = h('div', { class: 'playerbar' });
  els.main.append(
    h('div', { class: 'topbar' }, els.title,
      h('div', { class: 'search' }, search, icon('search')),
      uploadBtn, els.adminBtn, els.membersBtn),
    els.content,
    els.playerBar,
  );

  setupDrop();
  renderSidebar();
  renderUserPanel();
  renderSyncState();
  renderGrid();
  renderMembers();
  renderPlayerBar();
}

function renderSyncState() {
  if (!els.syncState) return;
  const cls = !state.connected ? 'offline' : state.syncing ? 'syncing' : '';
  const text = !state.connected ? 'нет связи' : state.syncing ? 'синхронизация' : 'в сети';
  els.syncState.className = `sync-state ${cls}`;
  els.syncState.replaceChildren(h('span', { class: 'pulse' }), text);
}

function categories() {
  const map = new Map();
  for (const s of state.sounds) if (s.category) map.set(s.category, (map.get(s.category) ?? 0) + 1);
  return [...map].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
}

function setView(v) {
  state.view = v;
  renderSidebar();
  renderGrid();
}

function renderSidebar() {
  if (!els.nav) return;
  const favs = new Set(S('favorites'));
  const item = (view, iconEl, name, count) => h('button', {
    class: `nav-item ${state.view === view ? 'active' : ''}`,
    onclick: () => setView(view),
  }, iconEl, h('span', { class: 'name' }, name), count != null ? h('span', { class: 'count' }, count) : null);

  els.nav.replaceChildren(
    item('all', icon('all'), 'Все звуки', state.sounds.length),
    item('fav', icon('star'), 'Избранное', state.sounds.filter((s) => favs.has(s.id)).length),
    item('mine', icon('user'), 'Мои звуки', state.sounds.filter((s) => s.uploadedById === state.user.id).length),
    h('div', { class: 'nav-section' }, 'Категории'),
    ...categories().map(([c, n]) => item(`cat:${c}`, h('span', { class: 'hash' }, '#'), c, n)),
    state.sounds.some((s) => !s.category) ? item('cat:', h('span', { class: 'hash' }, '#'), 'без категории', state.sounds.filter((s) => !s.category).length) : null,
  );
  els.adminBtn.style.display = state.user.isAdmin ? '' : 'none';
}

function renderUserPanel() {
  if (!els.userPanel || !state.user) return;
  const micOn = S('micEnabled');
  els.userPanel.replaceChildren(
    avatar(state.user, { online: state.connected }),
    h('div', { class: 'who' },
      h('div', { class: 'uname' }, state.user.username),
      h('div', { class: 'ustatus' }, state.user.isAdmin ? 'админ' : 'в сети')),
    h('button', {
      class: `icon-btn ${micOn ? '' : 'off'}`,
      title: micOn ? 'Микрофон идёт в Discord через SoundPad (нажми, чтобы выключить)' : 'Микрофон не подмешивается',
      onclick: async () => { await saveSettings({ micEnabled: !micOn }); applyAudio().catch((e) => toast(e.message, 'error')); },
    }, icon(micOn ? 'mic' : 'micOff')),
    h('button', { class: 'icon-btn', title: 'Настройки', onclick: () => openSettings() }, icon('gear')),
  );
}

function filteredSounds() {
  const favs = new Set(S('favorites'));
  const q = state.search.trim().toLowerCase();
  return state.sounds.filter((s) => {
    if (state.view === 'fav' && !favs.has(s.id)) return false;
    if (state.view === 'mine' && s.uploadedById !== state.user.id) return false;
    if (state.view.startsWith('cat:') && s.category !== state.view.slice(4)) return false;
    if (q && !`${s.name} ${s.category} ${s.uploadedBy ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function viewTitle() {
  if (state.view === 'all') return [icon('all'), 'Все звуки'];
  if (state.view === 'fav') return [icon('star'), 'Избранное'];
  if (state.view === 'mine') return [icon('user'), 'Мои звуки'];
  return [h('span', { class: 'hash' }, '#'), state.view.slice(4) || 'без категории'];
}

export function renderGrid() {
  if (!els.gridWrap) return;
  els.title.replaceChildren(...viewTitle());
  els.title.querySelector('svg')?.setAttribute('style', 'width:20px;height:20px;color:var(--text-faint)');
  const list = filteredSounds();
  const overlay = h('div', { class: 'drop-overlay' }, 'Отпусти, чтобы загрузить звуки');

  if (!list.length) {
    const empty = state.sounds.length
      ? h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔍'), h('h3', {}, 'Ничего не нашлось'),
        h('div', {}, state.view === 'fav' ? 'Нажми ☆ на плитке, чтобы добавить звук в избранное.' : 'Попробуй другой запрос.'))
      : h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔊'), h('h3', {}, 'Тут пока тихо'),
        h('div', {}, 'Перетащи аудиофайлы в окно или нажми кнопку ниже.'),
        h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => openUpload() }, icon('upload'), 'Загрузить звуки'));
    els.gridWrap.replaceChildren(empty, overlay);
    return;
  }

  const grid = h('div', { class: 'grid' });
  // На вкладке «Все» группируем по категориям
  if (state.view === 'all' && !state.search) {
    let last = null;
    for (const s of list) {
      if (s.category !== last) {
        grid.append(h('div', { class: 'group-title' }, s.category || 'Без категории'));
        last = s.category;
      }
      grid.append(tile(s));
    }
  } else {
    list.forEach((s) => grid.append(tile(s)));
  }
  els.gridWrap.replaceChildren(grid, overlay);
}

function tile(s) {
  const favs = new Set(S('favorites'));
  const hk = S('hotkeys')[s.id];
  const el = h('button', {
    class: `tile ${engine.isPlaying(s.id) ? 'playing' : ''}`,
    'data-id': s.id,
    title: `${s.name}\nЗагрузил: ${s.uploadedBy ?? '—'}\nЛКМ — играть, Shift+ЛКМ — стоп, ПКМ — меню`,
    onclick: (e) => (e.shiftKey ? engine.stop(s.id) : play(s)),
    oncontextmenu: (e) => { e.preventDefault(); soundMenu(s, e.clientX, e.clientY); },
  },
  h('div', { class: 't-top' }, s.emoji ? h('span', { class: 'emoji' }, s.emoji) : null, h('div', { class: 't-name' }, s.name)),
  h('div', { class: 't-bottom' }, h('span', { class: 'who' }, s.uploadedBy ?? ''), hk ? h('span', { class: 'kbd' }, prettyAccel(hk)) : null),
  h('button', {
    class: `star ${favs.has(s.id) ? 'on' : ''}`, title: 'В избранное',
    onclick: (e) => { e.stopPropagation(); toggleFav(s.id); },
  }, icon('star')),
  h('div', { class: 'bar' }));
  return el;
}

async function toggleFav(id) {
  const favs = new Set(S('favorites'));
  favs.has(id) ? favs.delete(id) : favs.add(id);
  await saveSettings({ favorites: [...favs] });
  renderSidebar();
  renderGrid();
}

function canEdit(s) {
  return state.user.isAdmin || s.uploadedById === state.user.id;
}

function soundMenu(s, x, y) {
  const favs = new Set(S('favorites'));
  contextMenu(x, y, [
    { label: 'Играть', action: () => play(s) },
    { label: 'Остановить', action: () => engine.stop(s.id) },
    '-',
    { label: favs.has(s.id) ? 'Убрать из избранного' : 'В избранное', action: () => toggleFav(s.id) },
    { label: 'Горячая клавиша…', hint: prettyAccel(S('hotkeys')[s.id]), action: () => openHotkeyDialog(s) },
    ...(canEdit(s) ? [
      '-',
      { label: 'Изменить…', action: () => openEditSound(s) },
      { label: 'Удалить', danger: true, action: () => deleteSoundUi(s) },
    ] : []),
  ]);
}

async function deleteSoundUi(s) {
  const ok = await confirmDialog({ title: `Удалить «${s.name}»?`, text: 'Звук пропадёт у всех. Это не отменить.' });
  if (!ok) return;
  try {
    await api('DELETE', `/api/sounds/${s.id}`);
    toast('Звук удалён');
  } catch (e) { toast(e.message, 'error'); }
}

function openEditSound(s) {
  const name = h('input', { class: 'input', value: s.name, maxlength: 80 });
  const emoji = h('input', { class: 'input', value: s.emoji, maxlength: 8, placeholder: '😂' });
  const category = h('input', { class: 'input', value: s.category, list: 'cat-list', placeholder: 'Без категории' });
  const vol = h('input', { type: 'range', min: 0, max: 200, value: Math.round(s.volume * 100) });
  const volLabel = h('span', { class: 'muted' }, `${vol.value}%`);
  vol.addEventListener('input', () => { volLabel.textContent = `${vol.value}%`; rangeFill(vol); });
  rangeFill(vol);
  const m = modal([
    h('div', { class: 'modal-head' }, h('h2', {}, 'Изменить звук')),
    h('div', { class: 'modal-body' },
      h('div', { class: 'row' },
        h('div', { class: 'field', style: { width: '90px' } }, h('label', { class: 'label' }, 'Эмодзи'), emoji),
        h('div', { class: 'field grow' }, h('label', { class: 'label' }, 'Название'), name)),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Категория'), category,
        h('datalist', { id: 'cat-list' }, categories().map(([c]) => h('option', { value: c })))),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Громкость звука (для всех)'), h('div', { class: 'row' }, vol, volLabel),
        h('div', { class: 'hint' }, 'Подровняй, если звук сильно тише или громче остальных.'))),
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            await api('PATCH', `/api/sounds/${s.id}`, { name: name.value, emoji: emoji.value, category: category.value, volume: vol.value / 100 });
            m.close();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, 'Сохранить')),
  ]);
  name.focus();
}

function hotkeyCapture(initial, onChange) {
  let value = initial || '';
  const text = h('span', { class: 'grow' });
  const el = h('div', { class: 'hotkey-capture', tabindex: 0 }, text);
  const show = () => { text.textContent = el.classList.contains('listening') ? 'Нажми сочетание… (Esc — отмена)' : value ? prettyAccel(value) : 'Не назначено'; };
  const stop = () => { el.classList.remove('listening'); document.removeEventListener('keydown', onKey, true); show(); };
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stop();
    if (e.key === 'Backspace' || e.key === 'Delete') { value = ''; onChange(value); return stop(); }
    const accel = accelFromEvent(e);
    if (accel) { value = accel; onChange(value); stop(); }
  };
  el.addEventListener('click', () => {
    if (el.classList.contains('listening')) return stop();
    el.classList.add('listening');
    document.addEventListener('keydown', onKey, true);
    show();
  });
  show();
  return el;
}

function openHotkeyDialog(s) {
  let accel = S('hotkeys')[s.id] || '';
  const conflict = h('div', { class: 'error-text' });
  const cap = hotkeyCapture(accel, (v) => {
    accel = v;
    const other = Object.entries(S('hotkeys')).find(([id, a]) => a === v && Number(id) !== s.id);
    const otherSound = other && state.sounds.find((x) => x.id === Number(other[0]));
    conflict.textContent = v && v === S('stopHotkey') ? 'Это сочетание уже стоит на «Стоп всё».'
      : otherSound ? `Сейчас стоит на «${otherSound.name}» — переназначится.` : '';
  });
  const m = modal([
    h('div', { class: 'modal-head' }, h('div', {}, h('h2', {}, 'Горячая клавиша'), h('p', {}, `Для «${s.name}». Работает и в игре.`))),
    h('div', { class: 'modal-body' }, cap, conflict,
      h('div', { class: 'hint' }, 'Нужен Ctrl, Alt или Shift (или F-клавиша / цифра на Num-блоке). Backspace — убрать.')),
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          const map = { ...S('hotkeys') };
          for (const [id, a] of Object.entries(map)) if (a === accel) delete map[id];
          if (accel) map[s.id] = accel; else delete map[s.id];
          await saveSettings({ hotkeys: map });
          await applyHotkeys();
          renderGrid();
          m.close();
        },
      }, 'Сохранить')),
  ]);
}

function renderMembers() {
  if (!els.members) return;
  els.members.style.display = S('showMembers') ? '' : 'none';
  els.membersBtn?.classList.toggle('active', S('showMembers'));
  els.members.replaceChildren(
    h('div', { class: 'nav-section' }, `В сети — ${state.online.length}`),
    ...state.online.map((u) => h('div', { class: 'member' }, avatar(u, { online: true }), h('span', { class: 'mname' }, u.username))),
  );
}

function renderPlayerBar() {
  if (!els.playerBar) return;
  const slider = (key, label, iconName, title) => {
    const r = h('input', { type: 'range', min: 0, max: 100, value: Math.round(S(key) * 100), title });
    rangeFill(r);
    r.addEventListener('input', () => {
      rangeFill(r);
      const v = r.value / 100;
      (key === 'monitorVolume' ? engine.monitor : engine.cable).setVolume(v);
    });
    r.addEventListener('change', () => saveSettings({ [key]: r.value / 100 }));
    return h('div', { class: 'vol', title }, icon(iconName), h('span', { class: 'vlabel' }, label), r);
  };
  els.nowPlaying = h('div', { class: 'now-playing' });
  els.playerBar.replaceChildren(
    h('button', { class: 'btn small secondary', title: `Остановить всё (${prettyAccel(S('stopHotkey'))})`, onclick: () => engine.stopAll() }, icon('stop'), 'Стоп'),
    els.nowPlaying,
    state.missingCable
      ? h('button', { class: 'warn-pill', onclick: () => openSettings('audio'), title: 'Без виртуального кабеля друзья не услышат звуки' }, '⚠ Не выбран вывод в Discord')
      : null,
    slider('monitorVolume', 'Мне', 'headphones', 'Громкость в твоих наушниках'),
    slider('cableVolume', 'В Discord', 'discord', 'Громкость, которую слышат друзья'),
  );
  renderNowPlaying();
}

function renderNowPlaying() {
  if (!els.nowPlaying) return;
  const names = [...new Set([...engine.playing.values()].map((p) => state.sounds.find((s) => s.id === p.soundId)?.name).filter(Boolean))];
  els.nowPlaying.replaceChildren(...(names.length ? ['Играет: ', h('b', {}, names.join(', '))] : ['Нажми на звук, чтобы сыграть']));
}

// ---------- Перетаскивание файлов ----------

function setupDrop() {
  let depth = 0;
  const wrap = els.gridWrap;
  wrap.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; wrap.classList.add('dragging'); });
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; wrap.classList.remove('dragging'); } });
  wrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    wrap.classList.remove('dragging');
    const paths = [...e.dataTransfer.files].map((f) => native.pathForFile(f)).filter(Boolean);
    const items = await native.describePaths(paths);
    if (!items.length) return toast('Среди файлов нет аудио (mp3, wav, ogg, m4a, flac…)', 'error');
    const cat = state.view.startsWith('cat:') ? state.view.slice(4) : '';
    openUpload(items.map((it) => ({ ...it, category: it.category || cat })));
  });
}

// ---------- Настройки ----------

export async function openSettings(tab = 'audio') {
  const body = h('div', { class: 'modal-body' });
  const head = h('div', { class: 'modal-head' });
  const tabs = {
    audio: { label: 'Звук и Discord', icon: 'speaker', render: renderAudioTab },
    hotkeys: { label: 'Горячие клавиши', icon: 'keyboard', render: renderHotkeysTab },
    account: { label: 'Аккаунт', icon: 'user', render: renderAccountTab },
  };
  const nav = h('div', { class: 'tabbed-nav' });
  const select = (key) => {
    tab = key;
    nav.replaceChildren(h('div', { class: 'nav-section' }, 'Настройки'),
      ...Object.entries(tabs).map(([k, t]) => h('button', { class: `nav-item ${k === tab ? 'active' : ''}`, onclick: () => select(k) }, icon(t.icon), h('span', { class: 'name' }, t.label))));
    head.replaceChildren(h('h2', {}, tabs[key].label), h('button', { class: 'icon-btn', onclick: () => m.close() }, icon('close')));
    body.replaceChildren();
    tabs[key].render(body);
  };
  const m = modal(h('div', { class: 'tabbed' }, nav, h('div', { class: 'tabbed-main' }, head, body)), { wide: true });
  select(tab);
}

async function renderAudioTab(body) {
  const { outputs, inputs } = await engine.listDevices();
  const devSelect = (key, list, extra = []) => {
    const sel = h('select', { class: 'select' },
      ...extra.map(([v, l]) => h('option', { value: v }, l)),
      ...list.filter((d) => d.id !== 'default').map((d) => h('option', { value: d.id }, d.label)));
    sel.value = S(key) ?? '';
    sel.addEventListener('change', async () => {
      await saveSettings({ [key]: sel.value });
      applyAudio().catch((e) => toast(`Аудио: ${e.message}`, 'error'));
    });
    return sel;
  };
  const toggle = (key, after) => {
    const input = h('input', { type: 'checkbox', checked: !!S(key) });
    input.addEventListener('change', async () => { await saveSettings({ [key]: input.checked }); after?.(); });
    return h('label', { class: 'toggle' }, input, h('span'));
  };
  const reapply = () => applyAudio().catch((e) => toast(`Аудио: ${e.message}`, 'error'));
  const cableFound = AudioEngine.guessCable(outputs);
  const cableMic = AudioEngine.guessCableMic(inputs);

  const micVol = h('input', { type: 'range', min: 0, max: 200, value: Math.round(S('micVolume') * 100) });
  rangeFill(micVol);
  micVol.addEventListener('input', () => { rangeFill(micVol); engine.micGain.gain.value = micVol.value / 100; });
  micVol.addEventListener('change', () => saveSettings({ micVolume: micVol.value / 100 }));

  body.append(
    cableFound ? null : h('div', { class: 'card', style: { borderLeft: '4px solid var(--yellow)' } },
      h('h4', {}, 'Не найден виртуальный кабель'),
      h('div', { class: 'muted' }, 'Чтобы друзья в Discord слышали звуки, установи бесплатный VB-Cable (vb-audio.com/Cable), перезагрузи ПК и выбери «CABLE Input» ниже.')),
    h('div', { class: 'card' },
      h('h4', {}, 'Как это работает'),
      h('div', { class: 'muted' },
        'SoundPad отправляет звуки и твой микрофон в виртуальный кабель. В Discord → Настройки → Голос и видео выбери устройством ввода ',
        h('b', {}, cableMic ? 'CABLE Output' : 'CABLE Output (VB-Audio)'),
        '. Шумоподавление Discord продолжит работать.')),
    h('div', { class: 'field' }, h('label', { class: 'label' }, 'Вывод в Discord (виртуальный кабель)'),
      devSelect('cableDevice', outputs, [['', '— выключено —']])),
    h('div', { class: 'field' }, h('label', { class: 'label' }, 'Где слышать звуки самому'),
      devSelect('monitorDevice', outputs, [['', 'Как в Windows (по умолчанию)'], ['none', '— не слышать —']])),
    h('div', { class: 'card' },
      h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('b', {}, 'Подмешивать микрофон'), h('span', {}, 'Нужно, если в Discord выбран CABLE Output — иначе тебя не услышат.')),
        toggle('micEnabled', () => { reapply(); renderUserPanel(); })),
      h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('b', {}, 'Микрофон'), devSelect('micDevice', inputs.filter((d) => d.id !== cableMic), [['default', 'Как в Windows (по умолчанию)']]))),
      h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('b', {}, 'Громкость микрофона'), micVol)),
      h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('b', {}, 'Звуки поверх друг друга'), h('span', {}, 'Если выключить, новый звук останавливает предыдущий.')),
        toggle('overlap', reapply))),
  );
}

function renderHotkeysTab(body) {
  const assigned = Object.entries(S('hotkeys'))
    .map(([id, accel]) => ({ sound: state.sounds.find((s) => s.id === Number(id)), accel }))
    .filter((x) => x.sound && x.accel);
  body.append(
    h('div', { class: 'card' },
      h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('b', {}, 'Остановить все звуки')),
        h('div', { style: { width: '220px' } }, hotkeyCapture(S('stopHotkey'), async (v) => { await saveSettings({ stopHotkey: v }); applyHotkeys(); renderPlayerBar(); })))),
    h('div', { class: 'label', style: { marginTop: '8px' } }, 'Клавиши для звуков'),
    assigned.length
      ? h('div', { class: 'card' }, assigned.map(({ sound, accel }) => h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('b', {}, sound.name)), h('span', { class: 'kbd' }, prettyAccel(accel)),
        h('button', {
          class: 'btn small ghost',
          onclick: async () => {
            const map = { ...S('hotkeys') };
            delete map[sound.id];
            await saveSettings({ hotkeys: map });
            await applyHotkeys();
            renderGrid();
            body.replaceChildren();
            renderHotkeysTab(body);
          },
        }, 'Убрать'))))
      : h('div', { class: 'muted' }, 'Пока нет. Нажми правой кнопкой на звук → «Горячая клавиша…».'),
    h('div', { class: 'hint', style: { marginTop: '12px' } }, 'Клавиши у каждого свои и хранятся только на этом ПК.'),
  );
}

function renderAccountTab(body) {
  const oldP = h('input', { class: 'input', type: 'password' });
  const newP = h('input', { class: 'input', type: 'password' });
  body.append(
    h('div', { class: 'card row' }, avatar(state.user),
      h('div', { class: 'grow' }, h('b', { style: { color: 'var(--text-strong)' } }, state.user.username),
        h('div', { class: 'muted' }, `${state.user.isAdmin ? 'Админ' : 'Участник'} · ${S('serverUrl')}`)),
      h('button', { class: 'btn danger small', onclick: () => { document.querySelector('.backdrop')?.remove(); logout(); } }, 'Выйти')),
    h('div', { class: 'label' }, 'Сменить пароль'),
    h('div', { class: 'row' },
      h('div', { class: 'field grow' }, h('label', { class: 'label' }, 'Старый'), oldP),
      h('div', { class: 'field grow' }, h('label', { class: 'label' }, 'Новый'), newP)),
    h('button', {
      class: 'btn',
      onclick: async () => {
        try {
          await api('POST', '/api/me/password', { oldPassword: oldP.value, newPassword: newP.value });
          oldP.value = newP.value = '';
          toast('Пароль изменён', 'ok');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'Сохранить пароль'),
  );
}

// Esc — стоп всего, Ctrl+F — поиск (только когда окно активно)
document.addEventListener('keydown', (e) => {
  if (!state.user || document.querySelector('.backdrop')) return;
  if (e.ctrlKey && e.code === 'KeyF') { e.preventDefault(); els.search?.focus(); }
  if (e.code === 'Escape' && document.activeElement !== els.search) engine.stopAll();
});

boot();
