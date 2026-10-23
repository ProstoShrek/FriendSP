import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { db, bumpVersion, getVersion } from './db.js';
import {
  hashPassword, verifyPassword, createSession, userByToken, publicUser,
  randomColor, newInviteCode, requireAuth, requireAdmin,
} from './auth.js';
import {
  listSounds, getSound, addSound, updateSound, deleteSound, soundFilePath,
  soundRow, scanImportDir, importFromServer,
} from './sounds.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Клиент ходит с file:// и авторизуется заголовком, без cookie, поэтому CORS можно открыть
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 50 },
});

// multer отдаёт имена файлов в latin1 — возвращаем нормальную кириллицу
const fixName = (n) => Buffer.from(n, 'latin1').toString('utf8');

const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

// ---------- Аккаунты ----------

const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,24}$/u;

app.get('/api/info', (req, res) => {
  const users = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  res.json({ name: 'SoundPad', needsSetup: users === 0, usersCanUpload: config.usersCanUpload, maxFileMb: config.maxFileMb });
});

app.post('/api/register', wrap((req, res) => {
  const { username, password, invite } = req.body ?? {};
  if (!USERNAME_RE.test(username ?? '')) return res.status(400).json({ error: 'Ник: 2–24 символа, буквы, цифры, _ . -' });
  if (typeof password !== 'string' || password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });

  const isFirst = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n === 0;
  let inv = null;
  if (!isFirst) {
    const code = String(invite ?? '').trim().toUpperCase();
    inv = db.prepare(`SELECT * FROM invites WHERE code = ? AND used_by IS NULL`).get(code);
    if (!inv) return res.status(400).json({ error: 'Инвайт-код неверный или уже использован' });
  }
  if (db.prepare(`SELECT 1 FROM users WHERE ukey = ?`).get(username.toLowerCase())) {
    return res.status(409).json({ error: 'Такой ник уже занят' });
  }

  const info = db.prepare(`INSERT INTO users(username, ukey, pass_hash, is_admin, color, created_at) VALUES(?, ?, ?, ?, ?, ?)`)
    .run(username, username.toLowerCase(), hashPassword(password), isFirst ? 1 : 0, randomColor(), Date.now());
  if (inv) db.prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?`).run(info.lastInsertRowid, Date.now(), inv.code);

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
  broadcast({ type: 'users' });
  res.json({ token: createSession(user.id), user: publicUser(user) });
}));

app.post('/api/login', wrap((req, res) => {
  const { username, password } = req.body ?? {};
  const user = db.prepare(`SELECT * FROM users WHERE ukey = ?`).get(String(username ?? '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password ?? ''), user.pass_hash)) {
    return res.status(401).json({ error: 'Неверный ник или пароль' });
  }
  res.json({ token: createSession(user.id), user: publicUser(user) });
}));

app.post('/api/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/me/password', requireAuth, wrap((req, res) => {
  const { oldPassword, newPassword } = req.body ?? {};
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  if (!verifyPassword(String(oldPassword ?? ''), u.pass_hash)) return res.status(400).json({ error: 'Старый пароль неверный' });
  if (typeof newPassword !== 'string' || newPassword.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  db.prepare(`UPDATE users SET pass_hash = ? WHERE id = ?`).run(hashPassword(newPassword), u.id);
  res.json({ ok: true });
}));

// ---------- Профили и аватарки ----------

const AVATAR_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

// Все участники: нужны клиенту для аватарок и званий у звуков
app.get('/api/users', requireAuth, (req, res) => {
  const users = db.prepare(`SELECT id, username, is_admin, color, avatar FROM users ORDER BY id`).all();
  res.json({ users: users.map(publicUser) });
});

function removeAvatarFile(file) {
  if (file) fs.rmSync(path.join(config.avatarsDir, path.basename(file)), { force: true });
}

app.post('/api/me/avatar', requireAuth, avatarUpload.single('avatar'), wrap((req, res) => {
  const f = req.file;
  const ext = f && AVATAR_TYPES[f.mimetype];
  if (!ext) return res.status(400).json({ error: 'Нужна картинка PNG, JPG, WEBP или GIF' });
  const hash = crypto.createHash('sha256').update(f.buffer).digest('hex').slice(0, 16);
  const file = `${req.user.id}-${hash}${ext}`;
  fs.writeFileSync(path.join(config.avatarsDir, file), f.buffer);
  if (req.user.avatar !== file) removeAvatarFile(req.user.avatar);
  db.prepare(`UPDATE users SET avatar = ? WHERE id = ?`).run(file, req.user.id);
  profileChanged();
  res.json({ avatar: file });
}));

app.delete('/api/me/avatar', requireAuth, (req, res) => {
  removeAvatarFile(req.user.avatar);
  db.prepare(`UPDATE users SET avatar = NULL WHERE id = ?`).run(req.user.id);
  profileChanged();
  res.json({ ok: true });
});

// Аватарки открыты без токена: имя файла содержит хэш и меняется при каждой загрузке
app.get('/api/avatars/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const abs = path.join(config.avatarsDir, file);
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(abs);
});

// ---------- Звуки ----------

app.get('/api/sounds', requireAuth, (req, res) => {
  res.json({ version: getVersion(), sounds: listSounds() });
});

app.get('/api/sounds/:id/file', requireAuth, (req, res) => {
  const s = getSound(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Звук не найден' });
  res.type(s.mime);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(soundFilePath(s));
});

app.post('/api/sounds', requireAuth, upload.array('files'), wrap((req, res) => {
  if (!config.usersCanUpload && !req.user.is_admin) return res.status(403).json({ error: 'Загружать звуки может только админ' });
  const files = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: 'Нет файлов' });

  // Категории можно передать по одной на файл (categories[]) или одну на всех (category)
  const cats = [].concat(req.body.categories ?? []);
  const names = [].concat(req.body.names ?? []);
  const result = { added: [], duplicates: 0, errors: [] };
  files.forEach((f, i) => {
    const originalName = fixName(f.originalname);
    try {
      const { sound, duplicate } = addSound({
        buffer: f.buffer,
        originalName,
        name: names[i],
        category: cats[i] ?? req.body.category,
        userId: req.user.id,
      });
      if (duplicate) result.duplicates++;
      else result.added.push(soundRow(sound));
    } catch (e) {
      result.errors.push({ file: originalName, error: e.message });
    }
  });
  if (result.added.length) notifySounds();
  res.json(result);
}));

function canEdit(user, sound) {
  return user.is_admin || sound.uploaded_by === user.id;
}

app.patch('/api/sounds/:id', requireAuth, wrap((req, res) => {
  const s = getSound(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Звук не найден' });
  if (!canEdit(req.user, s)) return res.status(403).json({ error: 'Можно менять только свои звуки' });
  const updated = updateSound(s.id, req.body ?? {});
  notifySounds(false);
  res.json({ sound: soundRow(updated) });
}));

app.delete('/api/sounds/:id', requireAuth, (req, res) => {
  const s = getSound(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Звук не найден' });
  if (!canEdit(req.user, s)) return res.status(403).json({ error: 'Можно удалять только свои звуки' });
  deleteSound(s.id);
  notifySounds(false);
  res.json({ ok: true });
});

// ---------- Админка ----------

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.color, u.avatar, u.created_at,
           (SELECT COUNT(*) FROM sounds s WHERE s.uploaded_by = u.id) AS sounds
    FROM users u ORDER BY u.created_at`).all();
  res.json({ users: users.map((u) => ({ ...publicUser(u), createdAt: u.created_at, sounds: u.sounds, online: onlineUserIds().has(u.id) })) });
});

app.patch('/api/admin/users/:id', requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const { isAdmin, password } = req.body ?? {};
  if (isAdmin !== undefined) {
    if (id === req.user.id && !isAdmin) return res.status(400).json({ error: 'Нельзя снять админку с себя' });
    db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(isAdmin ? 1 : 0, id);
  }
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    db.prepare(`UPDATE users SET pass_hash = ? WHERE id = ?`).run(hashPassword(password), id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
  }
  broadcast({ type: 'users' });
  res.json({ ok: true });
}));

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  for (const ws of wss.clients) if (ws.userId === id) ws.close(4001, 'deleted');
  broadcast({ type: 'users' });
  res.json({ ok: true });
});

app.get('/api/admin/invites', requireAdmin, (req, res) => {
  const invites = db.prepare(`
    SELECT i.code, i.created_at, i.used_at, u.username AS used_by
    FROM invites i LEFT JOIN users u ON u.id = i.used_by
    ORDER BY i.created_at DESC`).all();
  res.json({ invites: invites.map((i) => ({ code: i.code, createdAt: i.created_at, usedAt: i.used_at, usedBy: i.used_by })) });
});

app.post('/api/admin/invites', requireAdmin, (req, res) => {
  const code = newInviteCode();
  db.prepare(`INSERT INTO invites(code, created_by, created_at) VALUES(?, ?, ?)`).run(code, req.user.id, Date.now());
  res.json({ code });
});

app.delete('/api/admin/invites/:code', requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM invites WHERE code = ?`).run(req.params.code);
  res.json({ ok: true });
});

// Импорт из папки на сервере (DATA_DIR/import или IMPORT_DIR)
app.get('/api/admin/server-import', requireAdmin, (req, res) => {
  res.json({ dir: config.importDir, files: scanImportDir() });
});

app.post('/api/admin/server-import', requireAdmin, wrap((req, res) => {
  const { paths, category } = req.body ?? {};
  const list = Array.isArray(paths) ? paths.map(String) : scanImportDir().map((f) => f.path);
  const result = importFromServer(list, req.user.id, category ? String(category) : '');
  if (result.added) notifySounds(false);
  res.json(result);
}));

app.post('/api/admin/categories/rename', requireAdmin, wrap((req, res) => {
  const { from, to } = req.body ?? {};
  db.prepare(`UPDATE sounds SET category = ?, updated_at = ? WHERE category = ?`).run(String(to ?? '').trim().slice(0, 40), Date.now(), String(from ?? ''));
  notifySounds();
  res.json({ ok: true });
}));

// ---------- Ошибки ----------

app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const limit = req.path.includes('avatar') ? 3 : config.maxFileMb;
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Файл больше ${limit} МБ` : err.message;
    return res.status(413).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Ошибка сервера' : err.message });
});

// ---------- Живые обновления по WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const user = userByToken(token);
  if (!user) return ws.close(4001, 'unauthorized');
  ws.userId = user.id;
  ws.isAdmin = !!user.is_admin;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'hello', version: getVersion() }));
  broadcastPresence();
  ws.on('close', broadcastPresence);
});

// Пинги, чтобы отваливать мёртвые соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

function broadcast(msg, adminsOnly = false) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && (!adminsOnly || ws.isAdmin)) ws.send(data);
  }
}

function onlineUserIds() {
  return new Set([...wss.clients].map((ws) => ws.userId));
}

function broadcastPresence() {
  const ids = [...onlineUserIds()];
  const users = ids.length
    ? db.prepare(`SELECT id, username, color, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  broadcast({ type: 'presence', users });
}

function profileChanged() {
  broadcast({ type: 'users' });
  broadcastPresence();
}

function notifySounds(bump = true) {
  const version = bump ? bumpVersion() : getVersion();
  broadcast({ type: 'sounds', version });
}

// Адреса, по которым к серверу можно подключиться из программы
function connectAddresses() {
  const port = server.address().port;
  if (!['0.0.0.0', '::'].includes(config.host)) return [`${config.host}:${port}`];
  const out = [`localhost:${port}  (на этом ПК)`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${a.address}:${port}`);
    }
  }
  return out;
}

server.listen(config.port, config.host, () => {
  console.log('SoundPad server запущен. Адрес для программы:');
  for (const a of connectAddresses()) console.log(`  ${a}`);
  console.log(`Данные: ${config.dataDir}`);
  console.log(`Папка импорта: ${config.importDir}`);
  if (db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n === 0) {
    console.log('Пользователей пока нет: первый зарегистрированный станет админом (инвайт не нужен).');
  }
});

export { app, server };
