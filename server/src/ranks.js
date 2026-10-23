import crypto from 'node:crypto';
import { db } from './db.js';

// Стили ника, которые знает клиент (описаны в styles.css как .nick.s-<имя>)
export const RANK_STYLES = ['muted', 'plain', 'mint', 'toxic', 'ice', 'violet', 'fire', 'aurora', 'gold', 'prism'];

export const DEFAULT_RANKS = [
  { id: 'r0', min: 0, title: 'Тихоня', icon: '', style: 'muted' },
  { id: 'r1', min: 1, title: 'Слушатель', icon: '', style: 'plain' },
  { id: 'r2', min: 5, title: 'Звукач', icon: '🎧', style: 'mint' },
  { id: 'r3', min: 15, title: 'Диджей', icon: '💿', style: 'violet' },
  { id: 'r4', min: 30, title: 'Звукорежиссёр', icon: '🎛️', style: 'aurora' },
  { id: 'r5', min: 60, title: 'Легенда', icon: '👑', style: 'gold' },
  { id: 'r6', min: 100, title: 'Бог саундпада', icon: '⚡', style: 'prism' },
];

export function getRanks() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'ranks'`).get();
  if (!row) return DEFAULT_RANKS;
  try { return JSON.parse(row.value); } catch { return DEFAULT_RANKS; }
}

/** Проверяет и сохраняет список званий. Бросает ошибку с понятным текстом. */
export function saveRanks(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw badRequest('Нужно от 1 до 20 званий');
  const ranks = input.map((r) => {
    const title = String(r?.title ?? '').trim().slice(0, 24);
    if (!title) throw badRequest('У каждого звания должно быть название');
    const min = Math.floor(Number(r.min));
    if (!Number.isFinite(min) || min < 0 || min > 100000) throw badRequest(`Порог «${title}» должен быть числом от 0`);
    const style = RANK_STYLES.includes(r.style) ? r.style : 'plain';
    const id = /^[\w-]{1,32}$/.test(r.id ?? '') ? r.id : `r${crypto.randomBytes(4).toString('hex')}`;
    return { id, min, title, icon: String(r.icon ?? '').trim().slice(0, 8), style };
  }).sort((a, b) => a.min - b.min);
  // Самое младшее звание должно начинаться с нуля, иначе у новичков звания не будет
  ranks[0].min = 0;
  if (new Set(ranks.map((r) => r.id)).size !== ranks.length) throw badRequest('Повторяющиеся звания');
  db.prepare(`INSERT INTO meta(key, value) VALUES('ranks', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(ranks));
  return ranks;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
