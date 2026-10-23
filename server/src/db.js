import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.soundsDir, { recursive: true });
fs.mkdirSync(config.avatarsDir, { recursive: true });
fs.mkdirSync(config.importDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    -- Ник в нижнем регистре: SQLite NOCASE не понимает кириллицу
    ukey       TEXT NOT NULL UNIQUE,
    pass_hash  TEXT NOT NULL,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    color      TEXT NOT NULL,
    avatar     TEXT,
    -- Звание, выданное админом вручную (id из списка званий); NULL — по числу звуков
    rank_override TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sounds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    emoji       TEXT NOT NULL DEFAULT '',
    file        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    hash        TEXT NOT NULL,
    volume      REAL NOT NULL DEFAULT 1,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Миграции для баз, созданных старыми версиями
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
if (!userCols.includes('avatar')) db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
if (!userCols.includes('rank_override')) db.exec(`ALTER TABLE users ADD COLUMN rank_override TEXT`);

/** Версия коллекции: растёт при любом изменении звуков, клиенты по ней понимают, что пора синхронизироваться. */
export function bumpVersion() {
  db.prepare(`INSERT INTO meta(key, value) VALUES('version', '1')
              ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`).run();
  return getVersion();
}

export function getVersion() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get();
  return row ? Number(row.value) : 0;
}
