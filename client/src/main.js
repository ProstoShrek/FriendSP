const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, Menu } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.webm', '.opus']);
const UPLOAD_BATCH = 8;

let win = null;

// ---------- Настройки (JSON в папке пользователя) ----------

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const cacheDir = () => path.join(app.getPath('userData'), 'sounds-cache');

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}

function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const s = { ...readSettings(), ...patch };
  writeSettings(s);
  return s;
});

// ---------- Окно ----------

function createWindow() {
  const s = readSettings();
  win = new BrowserWindow({
    width: s.bounds?.width ?? 1180,
    height: s.bounds?.height ?? 760,
    x: s.bounds?.x,
    y: s.bounds?.y,
    minWidth: 860,
    minHeight: 540,
    frame: false,
    backgroundColor: '#1e1f22',
    title: 'SoundPad',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Звуки должны играть, даже когда окно свёрнуто (игра на весь экран)
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', () => writeSettings({ ...readSettings(), bounds: win.getBounds() }));
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));

  // Ссылки открываем в браузере, а не внутри программы
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('win:close', () => win?.close());

// ---------- Кэш звуков ----------

function cacheFile(sound) {
  const ext = path.extname(sound.file || '') || extFromMime(sound.mime);
  return path.join(cacheDir(), `${sound.hash}${ext}`);
}

function extFromMime(mime) {
  return { 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/webm': '.webm' }[mime] || '.bin';
}

/** Докачивает недостающие звуки и удаляет лишние. Прогресс шлёт в окно. */
ipcMain.handle('cache:sync', async (_e, { server, token, sounds }) => {
  await fsp.mkdir(cacheDir(), { recursive: true });
  const wanted = new Map(sounds.map((s) => [path.basename(cacheFile(s)), s]));
  const present = new Set(await fsp.readdir(cacheDir()));

  for (const name of present) {
    if (!wanted.has(name)) await fsp.rm(path.join(cacheDir(), name), { force: true });
  }

  const missing = [...wanted].filter(([name]) => !present.has(name)).map(([, s]) => s);
  let done = 0;
  const errors = [];
  const worker = async () => {
    while (missing.length) {
      const s = missing.shift();
      try {
        const res = await fetch(`${server}/api/sounds/${s.id}/file`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmp = `${cacheFile(s)}.part`;
        await fsp.writeFile(tmp, buf);
        await fsp.rename(tmp, cacheFile(s));
      } catch (err) {
        errors.push({ id: s.id, error: String(err.message || err) });
      }
      done++;
      win?.webContents.send('cache:progress', { done, total: done + missing.length });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { downloaded: done - errors.length, errors };
});

ipcMain.handle('cache:read', async (_e, sound) => {
  const buf = await fsp.readFile(cacheFile(sound));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('cache:has', (_e, sound) => fs.existsSync(cacheFile(sound)));

// ---------- Файлы и папки для загрузки ----------

function scanFolder(root) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
        const parts = r.split('/');
        out.push({
          path: abs,
          rel: r,
          name: path.basename(e.name, path.extname(e.name)).replace(/_+/g, ' ').trim(),
          // Подпапка первого уровня становится категорией
          category: parts.length > 1 ? parts[0] : '',
          size: fs.statSync(abs).size,
        });
      }
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

ipcMain.handle('fs:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка со звуками', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { folder: r.filePaths[0], files: scanFolder(r.filePaths[0]) };
});

ipcMain.handle('fs:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выбери звуки',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Аудио', extensions: [...AUDIO_EXTS].map((e) => e.slice(1)) }],
  });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ path: p, name: path.basename(p, path.extname(p)), category: '', size: fs.statSync(p).size }));
});

ipcMain.handle('fs:describe', (_e, paths) => {
  const out = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) out.push(...scanFolder(p));
      else if (AUDIO_EXTS.has(path.extname(p).toLowerCase())) {
        out.push({ path: p, name: path.basename(p, path.extname(p)), category: '', size: st.size });
      }
    } catch { /* файл пропал — пропускаем */ }
  }
  return out;
});

/** Загружает файлы пачками; items: [{ path, name, category }] */
ipcMain.handle('upload:files', async (_e, { server, token, items }) => {
  const result = { added: 0, duplicates: 0, errors: [] };
  for (let i = 0; i < items.length; i += UPLOAD_BATCH) {
    const batch = items.slice(i, i + UPLOAD_BATCH);
    const form = new FormData();
    for (const it of batch) {
      try {
        const buf = await fsp.readFile(it.path);
        form.append('files', new Blob([buf]), path.basename(it.path));
        form.append('names', it.name ?? '');
        form.append('categories', it.category ?? '');
      } catch (err) {
        result.errors.push({ file: it.path, error: err.message });
      }
    }
    try {
      const res = await fetch(`${server}/api/sounds`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      result.added += data.added.length;
      result.duplicates += data.duplicates;
      result.errors.push(...data.errors);
    } catch (err) {
      batch.forEach((it) => result.errors.push({ file: path.basename(it.path), error: err.message }));
    }
    win?.webContents.send('upload:progress', { done: Math.min(i + UPLOAD_BATCH, items.length), total: items.length });
  }
  return result;
});

// ---------- Глобальные горячие клавиши ----------

/** map: { "Ctrl+Alt+1": "sound:12", "Ctrl+Alt+0": "stop" } */
ipcMain.handle('hotkeys:set', (_e, map) => {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [accel, action] of Object.entries(map)) {
    try {
      const ok = globalShortcut.register(accel, () => win?.webContents.send('hotkey', action));
      if (!ok) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return { failed };
});

// ---------- Жизненный цикл ----------

// Одна копия программы: второй запуск просто показывает окно
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Разрешаем микрофон и выбор устройств вывода без лишних вопросов
    const ses = require('electron').session.defaultSession;
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'speaker-selection', 'clipboard-sanitized-write'].includes(perm)));
    createWindow();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
