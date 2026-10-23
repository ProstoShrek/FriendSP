import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  soundsDir: path.join(dataDir, 'sounds'),
  avatarsDir: path.join(dataDir, 'avatars'),
  dbPath: path.join(dataDir, 'soundpad.db'),
  // Папка на сервере, из которой админ может импортировать звуки
  importDir: path.resolve(process.env.IMPORT_DIR || path.join(dataDir, 'import')),
  maxFileMb: Number(process.env.MAX_FILE_MB || 15),
  // Может ли обычный пользователь загружать звуки (админ может всегда)
  usersCanUpload: (process.env.USERS_CAN_UPLOAD ?? 'true') !== 'false',
};

export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.webm', '.opus']);

export const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};
