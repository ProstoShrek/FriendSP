import { h, icon, toast, modal, confirmDialog, contextMenu, fmtSize, avatar } from './ui.js';
import { state, api, nameTag, styledName, userRank, loadRanks } from './app.js';
import { getRanks, STYLE_NAMES } from './ranks.js';
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
    categories: { label: 'Категории', icon: 'all', sub: 'Переименуй, объедини или убери категорию. Если переименовать в уже существующую, категории сольются.', render: categoriesTab },
    ranks: { label: 'Звания', icon: 'star', sub: 'Названия, пороги по числу звуков, иконки и оформление ника. Изменения сразу видны у всех.', render: ranksTab },
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
      h('thead', {}, h('tr', {}, h('th', {}, 'Ник'), h('th', {}, 'Роль'), h('th', {}, 'Звание'), h('th', { class: 'num' }, 'Звуков'), h('th', {}))),
      h('tbody', {}, users.map((u) => h('tr', {},
        h('td', {}, h('div', { class: 'row' }, avatar(u, { size: 'sm', online: u.online }), nameTag(u), u.id === state.user.id ? h('span', { class: 'badge' }, 'ты') : null)),
        h('td', {}, u.isAdmin ? h('span', { class: 'badge accent' }, 'админ') : h('span', { class: 'muted' }, 'участник')),
        h('td', {}, rankSelect(u)),
        h('td', { class: 'num' }, u.sounds),
        h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
          u.id === state.user.id ? null : h('button', {
            class: 'icon-btn', title: 'Действия',
            onclick: (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              contextMenu(r.left - 150, r.bottom + 4, [
                { label: u.isAdmin ? 'Снять админа' : 'Сделать админом', action: () => act(() => api('PATCH', `/api/admin/users/${u.id}`, { isAdmin: !u.isAdmin })) },
                { label: 'Новый пароль…', action: () => resetPassword(u) },
                '-',
                {
                  label: 'Удалить', danger: true,
                  action: async () => {
                    if (await confirmDialog({ title: `Удалить ${u.username}?`, text: 'Аккаунт удалится, его звуки останутся в коллекции.' })) {
                      act(() => api('DELETE', `/api/admin/users/${u.id}`));
                    }
                  },
                },
              ]);
            },
          }, icon('more'))))))));
  };
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'error'); } };
  // Звание по числу звуков или выданное вручную
  const rankSelect = (u) => {
    const sel = h('select', { class: 'select', style: { height: '30px', fontSize: '13px', minWidth: '150px' } },
      h('option', { value: '' }, 'Авто (по звукам)'),
      getRanks().map((r) => h('option', { value: r.id }, `${r.icon ? `${r.icon} ` : ''}${r.title}`)));
    sel.value = u.rankOverride ?? '';
    sel.addEventListener('change', () => act(() => api('PATCH', `/api/admin/users/${u.id}`, { rankOverride: sel.value || null })));
    return sel;
  };
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

// ---------- Категории ----------

function categoriesTab(body) {
  const load = () => {
    const counts = new Map();
    for (const s of state.sounds) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    const cats = [...counts].filter(([c]) => c).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    if (!cats.length) {
      body.replaceChildren(h('div', { class: 'muted' }, 'Категорий пока нет. Они появляются, когда у звуков указана категория.'));
      return;
    }
    body.replaceChildren(h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Категория'), h('th', { class: 'num' }, 'Звуков'), h('th', {}))),
      h('tbody', {}, cats.map(([name, n]) => {
        const input = h('input', { class: 'input', value: name, maxlength: 40, list: 'admin-cats' });
        const save = async () => {
          const to = input.value.trim();
          if (to === name) return;
          const merge = counts.has(to) && to;
          if (merge && !(await confirmDialog({ title: `Объединить с «${to}»?`, text: `Все звуки из «${name}» переедут в «${to}».`, ok: 'Объединить', danger: false }))) {
            input.value = name;
            return;
          }
          rename(name, to);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') input.value = name; });
        return h('tr', {},
          h('td', {}, input),
          h('td', { class: 'num' }, n),
          h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            h('button', { class: 'btn small ghost', onclick: save }, 'Сохранить'),
            h('button', {
              class: 'btn small danger',
              onclick: async () => {
                if (await confirmDialog({ title: `Убрать категорию «${name}»?`, text: 'Звуки останутся, просто окажутся без категории.', ok: 'Убрать' })) rename(name, '');
              },
            }, 'Убрать')));
      })),
      h('datalist', { id: 'admin-cats' }, cats.map(([c]) => h('option', { value: c })))));
  };
  const rename = async (from, to) => {
    try {
      await api('POST', '/api/admin/categories/rename', { from, to });
      toast(to ? `«${from}» → «${to}»` : `Категория «${from}» убрана`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
  // Список звуков обновится по сигналу сервера — перерисуем таблицу
  const onSounds = () => load();
  document.addEventListener('sounds-changed', onSounds);
  load();
  return () => document.removeEventListener('sounds-changed', onSounds);
}

// ---------- Звания ----------

function ranksTab(body, foot) {
  let rows = getRanks().map((r) => ({ ...r }));
  const preview = (r) => h('span', { class: 'rank-preview' }, styledName(r.title || 'Без названия', r));

  const render = () => {
    rows.sort((a, b) => a.min - b.min);
    body.replaceChildren(
      h('div', { class: 'hint', style: { marginBottom: '12px' } }, 'Наведи на ник в колонке «Как выглядит», чтобы увидеть анимацию. Первое звание всегда начинается с 0 звуков.'),
      h('table', { class: 'table ranks-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Иконка'), h('th', {}, 'Название'), h('th', {}, 'От звуков'), h('th', {}, 'Стиль'), h('th', {}, 'Как выглядит'), h('th', {}))),
        h('tbody', {}, rows.map((r, i) => {
          const cell = h('td', {}, preview(r));
          const refresh = () => cell.replaceChildren(preview(r));
          const styleSel = h('select', { class: 'select', style: { height: '30px', fontSize: '13px' } },
            Object.entries(STYLE_NAMES).map(([id, name]) => h('option', { value: id }, name)));
          styleSel.value = r.style;
          styleSel.addEventListener('change', () => { r.style = styleSel.value; refresh(); });
          return h('tr', {},
            h('td', { style: { width: '64px' } }, h('input', { class: 'input', value: r.icon, maxlength: 8, placeholder: '—', style: { textAlign: 'center' }, oninput: (e) => { r.icon = e.target.value; refresh(); } })),
            h('td', { style: { minWidth: '170px' } }, h('input', { class: 'input', value: r.title, maxlength: 24, oninput: (e) => { r.title = e.target.value; refresh(); } })),
            h('td', { style: { width: '80px' } }, h('input', { class: 'input', type: 'number', min: 0, value: r.min, disabled: i === 0, onchange: (e) => { r.min = Math.max(0, Number(e.target.value) || 0); render(); } })),
            h('td', { style: { width: '150px' } }, styleSel),
            cell,
            h('td', {}, rows.length > 1 ? h('button', { class: 'icon-btn', title: 'Удалить звание', onclick: () => { rows.splice(i, 1); render(); } }, icon('close')) : null));
        }))),
      h('button', {
        class: 'btn small secondary', style: { marginTop: '12px' },
        onclick: () => {
          const max = Math.max(...rows.map((r) => r.min));
          rows.push({ title: 'Новое звание', min: max + 10, icon: '', style: 'plain' });
          render();
        },
      }, icon('plus'), 'Добавить звание'));
  };

  const save = h('button', {
    class: 'btn',
    onclick: async () => {
      try {
        const { ranks } = await api('PUT', '/api/admin/ranks', { ranks: rows });
        rows = ranks.map((r) => ({ ...r }));
        await loadRanks();
        render();
        toast('Звания сохранены', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'Сохранить');
  const reset = h('button', {
    class: 'btn ghost',
    onclick: async () => {
      if (!(await confirmDialog({ title: 'Вернуть звания по умолчанию?', text: 'Твои названия и пороги заменятся стандартными.', ok: 'Вернуть' }))) return;
      try {
        const { ranks } = await api('DELETE', '/api/admin/ranks');
        rows = ranks.map((r) => ({ ...r }));
        await loadRanks();
        render();
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'По умолчанию');
  setFooter(foot, [reset, h('div', { class: 'grow' }), save]);
  render();
}
