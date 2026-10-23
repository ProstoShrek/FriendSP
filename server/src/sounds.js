import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, AUDIO_EXTS, MIME_BY_EXT } from './config.js';
import { db, bumpVersion } from './db.js';

export function soundRow(s) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    emoji: s.emoji,
    hash: s.hash,
    size: s.size,
    mime: s.mime,
    volume: s.volume,
    uploadedBy: s.uploader ?? null,
    uploadedById: s.uploaded_by,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export function listSounds() {
  return db.prepare(`
    SELECT s.*, u.username AS uploader
    FROM sounds s LEFT JOIN users u ON u.id = s.uploaded_by
    ORDER BY s.category COLLATE NOCASE, s.name COLLATE NOCASE`).all().map(soundRow);
}

export function getSound(id) {
  return db.prepare(`SELECT * FROM sounds WHERE id = ?`).get(id) ?? null;
}

export function isAudioFile(filename) {
  return AUDIO_EXTS.has(path.extname(filename).toLowerCase());
}

export function cleanName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Без названия';
}

export function cleanCategory(cat) {
  return String(cat ?? '').replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Сохраняет звук из буфера. Одинаковые по содержимому файлы не дублируются.
 * @returns {{ sound: object, duplicate: boolean }}
 */
export function addSound({ buffer, originalName, name, category, emoji, userId }) {
  const ext = path.extname(originalName).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) throw Object.assign(new Error(`Формат ${ext || '?'} не поддерживается`), { status: 400 });
  if (buffer.length > config.maxFileMb * 1024 * 1024) {
    throw Object.assign(new Error(`Файл больше ${config.maxFileMb} МБ`), { status: 413 });
  }

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = db.prepare(`SELECT * FROM sounds WHERE hash = ?`).get(hash);
  if (existing) return { sound: existing, duplicate: true };

  const file = `${hash}${ext}`;
  fs.writeFileSync(path.join(config.soundsDir, file), buffer);
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO sounds(name, category, emoji, file, mime, size, hash, uploaded_by, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    (name && String(name).trim().slice(0, 80)) || cleanName(originalName),
    cleanCategory(category),
    String(emoji ?? '').slice(0, 8),
    file,
    MIME_BY_EXT[ext] || 'application/octet-stream',
    buffer.length,
    hash,
    userId ?? null,
    now,
    now,
  );
  return { sound: getSound(info.lastInsertRowid), duplicate: false };
}

export function updateSound(id, patch) {
  const s = getSound(id);
  if (!s) return null;
  const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 80) || s.name : s.name;
  const category = patch.category !== undefined ? cleanCategory(patch.category) : s.category;
  const emoji = patch.emoji !== undefined ? String(patch.emoji).slice(0, 8) : s.emoji;
  let volume = s.volume;
  if (patch.volume !== undefined) {
    volume = Math.min(2, Math.max(0, Number(patch.volume)));
    if (!Number.isFinite(volume)) volume = s.volume;
  }
  db.prepare(`UPDATE sounds SET name = ?, category = ?, emoji = ?, volume = ?, updated_at = ? WHERE id = ?`)
    .run(name, category, emoji, volume, Date.now(), id);
  bumpVersion();
  return getSound(id);
}

export function deleteSound(id) {
  const s = getSound(id);
  if (!s) return false;
  db.prepare(`DELETE FROM sounds WHERE id = ?`).run(id);
  fs.rmSync(path.join(config.soundsDir, s.file), { force: true });
  bumpVersion();
  return true;
}

export function soundFilePath(s) {
  return path.join(config.soundsDir, s.file);
}

/** Аудиофайлы в папке импорта на сервере. Категория = имя первой подпапки. */
export function scanImportDir() {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && isAudioFile(e.name)) {
        const parts = r.split('/');
        out.push({
          path: r,
          name: cleanName(e.name),
          category: parts.length > 1 ? cleanCategory(parts[0]) : '',
          size: fs.statSync(abs).size,
        });
      }
    }
  };
  walk(config.importDir, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function importFromServer(relPaths, userId, defaultCategory) {
  const root = path.resolve(config.importDir);
  const result = { added: 0, duplicates: 0, errors: [] };
  for (const rel of relPaths) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) {
      result.errors.push({ path: rel, error: 'Путь вне папки импорта' });
      continue;
    }
    try {
      const parts = rel.split('/');
      const category = defaultCategory || (parts.length > 1 ? parts[0] : '');
      const { duplicate } = addSound({ buffer: fs.readFileSync(abs), originalName: path.basename(abs), category, userId });
      duplicate ? result.duplicates++ : result.added++;
    } catch (e) {
      result.errors.push({ path: rel, error: e.message });
    }
  }
  if (result.added) bumpVersion();
  return result;
}
