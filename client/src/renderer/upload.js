import { h, icon, toast, modal, fmtSize } from './ui.js';
import { state, saveSettings } from './app.js';

const native = window.native;

/**
 * Таблица файлов перед загрузкой: можно снять галочки, поправить имя и категорию.
 * Используется и в обычной загрузке, и в админке («из папки»).
 */
export function uploadPanel(items, { onDone, folderLabel } = {}) {
  const rows = items.map((it) => ({ ...it, checked: true }));
  const allCat = h('input', { class: 'input', placeholder: 'Оставить как есть', list: 'upload-cats' });
  const progress = h('div', { class: 'progress', style: { display: 'none', marginTop: '12px' } }, h('div', { style: { width: '0%' } }));
  const status = h('div', { class: 'hint' });
  const tbody = h('tbody');
  const counter = h('span', { class: 'muted' });
  const cats = [...new Set(state.sounds.map((s) => s.category).filter(Boolean))];

  const renderCounter = () => {
    const sel = rows.filter((r) => r.checked);
    counter.textContent = `Выбрано ${sel.length} из ${rows.length} · ${fmtSize(sel.reduce((a, r) => a + r.size, 0))}`;
  };

  const tooBig = (r) => r.size > (state.serverInfo?.maxFileMb ?? 15) * 1024 * 1024;
  rows.forEach((r) => {
    if (tooBig(r)) r.checked = false;
    const cb = h('input', { type: 'checkbox', checked: r.checked, disabled: tooBig(r), onchange: (e) => { r.checked = e.target.checked; renderCounter(); } });
    const name = h('input', { class: 'input', value: r.name, maxlength: 80, oninput: (e) => { r.name = e.target.value; } });
    const cat = h('input', { class: 'input', value: r.category, list: 'upload-cats', placeholder: '—', oninput: (e) => { r.category = e.target.value; } });
    r.catInput = cat;
    tbody.append(h('tr', {},
      h('td', { style: { width: '32px' } }, cb),
      h('td', {}, name),
      h('td', { style: { width: '180px' } }, cat),
      h('td', { class: 'num', style: { width: '80px', color: tooBig(r) ? 'var(--red)' : '' }, title: tooBig(r) ? 'Слишком большой файл' : '' }, fmtSize(r.size))));
  });
  allCat.addEventListener('input', () => rows.forEach((r) => { r.category = allCat.value || r.originalCategory; r.catInput.value = r.category; }));
  rows.forEach((r) => { r.originalCategory = r.category; });

  const toggleAll = h('input', {
    type: 'checkbox', checked: true,
    onchange: (e) => {
      rows.forEach((r, i) => { if (!tooBig(r)) { r.checked = e.target.checked; tbody.children[i].querySelector('input[type=checkbox]').checked = r.checked; } });
      renderCounter();
    },
  });

  const go = h('button', {
    class: 'btn',
    onclick: async () => {
      const selected = rows.filter((r) => r.checked);
      if (!selected.length) return toast('Ничего не выбрано', 'error');
      go.disabled = true;
      progress.style.display = '';
      const off = native.onUploadProgress(({ done, total }) => {
        progress.firstChild.style.width = `${(done / total) * 100}%`;
        status.textContent = `Загружено ${done} из ${total}…`;
      });
      try {
        const r = await native.uploadFiles({
          server: state.settings.serverUrl,
          token: state.settings.token,
          items: selected.map(({ path, name, category }) => ({ path, name, category })),
        });
        const parts = [`Добавлено: ${r.added}`];
        if (r.duplicates) parts.push(`уже были: ${r.duplicates}`);
        if (r.errors.length) parts.push(`ошибок: ${r.errors.length}`);
        status.textContent = parts.join(' · ');
        if (r.errors.length) {
          status.append(h('div', { class: 'error-text' }, r.errors.slice(0, 5).map((e) => h('div', {}, `${e.file}: ${e.error}`))));
        }
        toast(parts.join(' · '), r.errors.length ? 'error' : 'ok');
        if (folderLabel) await saveSettings({ lastFolder: folderLabel });
        onDone?.(r);
      } finally {
        off();
        go.disabled = false;
      }
    },
  }, icon('upload'), 'Загрузить');

  renderCounter();
  return {
    el: h('div', {},
      h('datalist', { id: 'upload-cats' }, cats.map((c) => h('option', { value: c }))),
      h('div', { class: 'row', style: { marginBottom: '12px' } },
        h('div', { class: 'grow' }, h('label', { class: 'label' }, 'Категория для всех'), allCat)),
      h('div', { class: 'file-list' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, toggleAll), h('th', {}, 'Название'), h('th', {}, 'Категория'), h('th', { class: 'num' }, 'Размер'))),
        tbody)),
      progress, status),
    footer: [counter, h('div', { class: 'grow' }), go],
  };
}

/** Загрузка звуков любым пользователем: выбор файлов, папки или перетаскивание. */
export function openUpload(items = null) {
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot', style: { alignItems: 'center' } });
  const m = modal([
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Загрузить звуки'), h('p', {}, 'Звуки появятся у всех друзей сразу после загрузки.')),
      h('button', { class: 'icon-btn', onclick: () => m.close() }, icon('close'))),
    body, foot,
  ], { wide: !!items });

  const show = (list) => {
    if (!list?.length) return toast('Аудиофайлов не найдено', 'error');
    m.el.classList.add('wide');
    const panel = uploadPanel(list, { onDone: (r) => { if (!r.errors.length) setTimeout(m.close, 600); } });
    body.replaceChildren(panel.el);
    foot.replaceChildren(...panel.footer);
  };

  if (items) return show(items);
  body.append(h('div', { class: 'row', style: { gap: '12px', padding: '8px 0' } },
    h('button', { class: 'btn grow', onclick: async () => show(await native.pickFiles()) }, icon('upload'), 'Выбрать файлы'),
    h('button', { class: 'btn secondary grow', onclick: async () => { const r = await native.pickFolder(); if (r) show(r.files); } }, icon('folder'), 'Выбрать папку')));
  body.append(h('div', { class: 'hint' }, 'Можно просто перетащить файлы или папку в окно. Подпапки станут категориями. Форматы: mp3, wav, ogg, m4a, flac, webm.'));
  foot.remove();
}
