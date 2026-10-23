import { h, icon, toast, modal, confirmDialog, fmtSize, avatar } from './ui.js';
import { state, api } from './app.js';
import { uploadPanel } from './upload.js';

const native = window.native;

export function openAdmin(tab = 'folder') {
  const head = h('div', { class: 'modal-head' });
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot', style: { alignItems: 'center' } });
  const tabs = {
    folder: { label: 'Из папки на ПК', icon: 'folder', sub: 'Выбери папку — все аудиофайлы из неё попадут в коллекцию. Подпапки станут категориями.', render: folderTab },
    server: { label: 'С сервера', icon: 'server', sub: 'Импорт из папки import на самом сервере — для больших коллекций, без загрузки через интернет.', render: serverTab },
    users: { label: 'Пользователи', icon: 'users', sub: 'Кто есть на сервере. Можно выдать админку, сбросить пароль или удалить.', render: usersTab },
    invites: { label: 'Инвайты', icon: 'ticket', sub: 'Одноразовые коды для регистрации друзей.', render: invitesTab },
  };
  const nav = h('div', { class: 'tabbed-nav' });
  let cleanup = null;
  const select = (key) => {
    cleanup?.();
    cleanup = null;
    nav.replaceChildren(h('div', { class: 'nav-section' }, 'Админка'),
      ...Object.entries(tabs).map(([k, t]) => h('button', { class: `nav-item ${k === key ? 'active' : ''}`, onclick: () => select(k) }, icon(t.icon), h('span', { class: 'name' }, t.label))));
    head.replaceChildren(h('div', {}, h('h2', {}, tabs[key].label), h('p', {}, tabs[key].sub)), h('button', { class: 'icon-btn', onclick: () => m.close() }, icon('close')));
    body.replaceChildren();
    foot.replaceChildren();
    foot.style.display = 'none';
    const r = tabs[key].render(body, foot);
    cleanup = typeof r === 'function' ? r : null;
  };
  const m = modal(h('div', { class: 'tabbed' }, nav, h('div', { class: 'tabbed-main' }, head, body, foot)), { wide: true, onClose: () => cleanup?.() });
  select(tab);
}

function setFooter(foot, children) {
  foot.replaceChildren(...children);
  foot.style.display = children.length ? '' : 'none';
}

// ---------- Загрузка из папки на ПК ----------

function folderTab(body, foot) {
  const pick = async () => {
    const r = await native.pickFolder();
    if (!r) return;
    if (!r.files.length) return toast('В папке нет аудиофайлов', 'error');
    const panel = uploadPanel(r.files, { folderLabel: r.folder });
    body.replaceChildren(
      h('div', { class: 'row', style: { marginBottom: '12px' } },
        icon('folder'), h('div', { class: 'grow muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.folder),
        h('button', { class: 'btn small secondary', onclick: pick }, 'Другая папка')),
      panel.el);
    setFooter(foot, panel.footer);
  };
  body.append(h('div', { class: 'empty', style: { height: 'auto', padding: '48px 0' } },
    h('div', { class: 'big' }, '📁'),
    h('h3', {}, 'Загрузить целую папку'),
    h('div', {}, 'Одинаковые файлы не задублируются — можно загружать одну и ту же папку повторно.'),
    h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: pick }, icon('folder'), 'Выбрать папку'),
    state.settings.lastFolder ? h('div', { class: 'hint' }, `В прошлый раз: ${state.settings.lastFolder}`) : null));
}

// ---------- Импорт из папки на сервере ----------

async function serverTab(body, foot) {
  body.append(h('div', { class: 'muted' }, 'Загружаю список…'));
  let data;
  try { data = await api('GET', '/api/admin/server-import'); } catch (e) {
    body.replaceChildren(h('div', { class: 'error-text' }, e.message));
    return;
  }
  const existing = new Set(state.sounds.map((s) => `${s.category}/${s.name}`.toLowerCase()));
  const rows = data.files.map((f) => ({ ...f, checked: !existing.has(`${f.category}/${f.name}`.toLowerCase()) }));
  const cat = h('input', { class: 'input', placeholder: 'По подпапкам' });
  const status = h('div', { class: 'hint' });

  if (!rows.length) {
    body.replaceChildren(h('div', { class: 'card' },
      h('h4', {}, 'Папка импорта пуста'),
      h('div', { class: 'muted' }, 'Положи аудиофайлы на сервер в папку:'),
      h('div', { class: 'invite-code', style: { fontSize: '13px', margin: '8px 0', userSelect: 'text' } }, data.dir),
      h('div', { class: 'muted' }, 'Если сервер в Docker — это папка ./data/import рядом с docker-compose.yml. Подпапки станут категориями. Потом нажми «Обновить».')),
    h('button', { class: 'btn secondary', onclick: () => { body.replaceChildren(); serverTab(body, foot); } }, 'Обновить'));
    return;
  }

  const tbody = h('tbody', {}, rows.map((r) => h('tr', {},
    h('td', { style: { width: '32px' } }, h('input', { type: 'checkbox', checked: r.checked, onchange: (e) => { r.checked = e.target.checked; } })),
    h('td', {}, r.path),
    h('td', { class: 'muted' }, r.category || '—'),
    h('td', { class: 'num' }, fmtSize(r.size)))));

  body.replaceChildren(
    h('div', { class: 'hint', style: { marginBottom: '12px' } }, `Папка на сервере: ${data.dir}. Уже загруженные звуки не повторятся.`),
    h('div', { class: 'field' }, h('label', { class: 'label' }, 'Категория для всех'), cat),
    h('div', { class: 'file-list' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Файл'), h('th', {}, 'Категория'), h('th', { class: 'num' }, 'Размер'))), tbody)),
    status);

  const go = h('button', {
    class: 'btn',
    onclick: async () => {
      const paths = rows.filter((r) => r.checked).map((r) => r.path);
      if (!paths.length) return toast('Ничего не выбрано', 'error');
      go.disabled = true;
      status.textContent = 'Импортирую…';
      try {
        const r = await api('POST', '/api/admin/server-import', { paths, category: cat.value.trim() });
        status.textContent = `Добавлено: ${r.added} · уже были: ${r.duplicates} · ошибок: ${r.errors.length}`;
        toast(status.textContent, r.errors.length ? 'error' : 'ok');
      } catch (e) {
        status.textContent = e.message;
      } finally { go.disabled = false; }
    },
  }, icon('server'), 'Импортировать');
  setFooter(foot, [h('span', { class: 'muted' }, `Файлов: ${rows.length}`), h('div', { class: 'grow' }),
    h('button', { class: 'btn ghost', onclick: () => { body.replaceChildren(); serverTab(body, foot); } }, 'Обновить'), go]);
}

// ---------- Пользователи ----------

function usersTab(body) {
  const load = async () => {
    let users;
    try { ({ users } = await api('GET', '/api/admin/users')); } catch (e) {
      body.replaceChildren(h('div', { class: 'error-text' }, e.message));
      return;
    }
    body.replaceChildren(h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Ник'), h('th', {}, 'Роль'), h('th', { class: 'num' }, 'Звуков'), h('th', {}))),
      h('tbody', {}, users.map((u) => h('tr', {},
        h('td', {}, h('div', { class: 'row' }, avatar(u, { size: 'sm', online: u.online }), h('b', {}, u.username), u.id === state.user.id ? h('span', { class: 'badge' }, 'ты') : null)),
        h('td', {}, u.isAdmin ? h('span', { class: 'badge accent' }, 'админ') : h('span', { class: 'muted' }, 'участник')),
        h('td', { class: 'num' }, u.sounds),
        h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
          u.id === state.user.id ? null : [
            h('button', { class: 'btn small ghost', onclick: () => act(() => api('PATCH', `/api/admin/users/${u.id}`, { isAdmin: !u.isAdmin })) }, u.isAdmin ? 'Снять админа' : 'В админы'),
            h('button', { class: 'btn small ghost', onclick: () => resetPassword(u) }, 'Новый пароль'),
            h('button', {
              class: 'btn small danger',
              onclick: async () => {
                if (await confirmDialog({ title: `Удалить ${u.username}?`, text: 'Аккаунт удалится, его звуки останутся в коллекции.' })) {
                  act(() => api('DELETE', `/api/admin/users/${u.id}`));
                }
              },
            }, 'Удалить'),
          ]))))));
  };
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'error'); } };
  const resetPassword = (u) => {
    const pass = h('input', { class: 'input', value: Math.random().toString(36).slice(2, 10) });
    const m = modal([
      h('div', { class: 'modal-head' }, h('div', {}, h('h2', {}, `Новый пароль для ${u.username}`), h('p', {}, 'Передай его другу, он сможет сменить его в настройках.'))),
      h('div', { class: 'modal-body' }, pass),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'),
        h('button', { class: 'btn', onclick: async () => { try { await api('PATCH', `/api/admin/users/${u.id}`, { password: pass.value }); toast('Пароль сброшен', 'ok'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, 'Сохранить')),
    ]);
  };
  const onChange = () => load();
  document.addEventListener('users-changed', onChange);
  load();
  return () => document.removeEventListener('users-changed', onChange);
}

// ---------- Инвайты ----------

function invitesTab(body, foot) {
  const list = h('div');
  const load = async () => {
    const { invites } = await api('GET', '/api/admin/invites');
    list.replaceChildren(invites.length ? h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Код'), h('th', {}, 'Статус'), h('th', {}))),
      h('tbody', {}, invites.map((i) => h('tr', {},
        h('td', {}, h('span', { class: 'invite-code' }, i.code)),
        h('td', {}, i.usedBy ? h('span', { class: 'muted' }, `использовал ${i.usedBy}`) : h('span', { class: 'badge accent' }, 'свободен')),
        h('td', { style: { textAlign: 'right' } }, i.usedBy ? null : [
          h('button', { class: 'btn small ghost', onclick: () => copy(i.code) }, 'Копировать'),
          h('button', { class: 'btn small ghost', onclick: async () => { await api('DELETE', `/api/admin/invites/${i.code}`); load(); } }, 'Отозвать'),
        ])))))
      : h('div', { class: 'muted' }, 'Кодов пока нет.'));
  };
  const copy = (code) => {
    const text = `Залетай в SoundPad!\nСервер: ${state.settings.serverUrl.replace(/^http:\/\//, '')}\nИнвайт-код: ${code}`;
    navigator.clipboard.writeText(text);
    toast('Скопировано: адрес сервера и код', 'ok');
  };
  body.append(list);
  setFooter(foot, [h('div', { class: 'grow' }), h('button', {
    class: 'btn',
    onclick: async () => {
      try {
        const { code } = await api('POST', '/api/admin/invites');
        await load();
        copy(code);
      } catch (e) { toast(e.message, 'error'); }
    },
  }, icon('plus'), 'Создать инвайт')]);
  load().catch((e) => list.replaceChildren(h('div', { class: 'error-text' }, e.message)));
}
