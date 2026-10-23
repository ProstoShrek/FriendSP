import crypto from 'node:crypto';
import { db } from './db.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions(token, user_id, created_at) VALUES(?, ?, ?)`).run(token, userId, Date.now());
  return token;
}

export function userByToken(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.color, u.avatar, u.rank_override
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`).get(token) ?? null;
}

export function publicUser(u) {
  return { id: u.id, username: u.username, isAdmin: !!u.is_admin, color: u.color, avatar: u.avatar ?? null, rankOverride: u.rank_override ?? null };
}

const AVATAR_COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f0b232', '#3ba55c', '#9b59b6', '#1abc9c', '#e67e22'];
export function randomColor() {
  return AVATAR_COLORS[crypto.randomInt(AVATAR_COLORS.length)];
}

export function newInviteCode() {
  // Короткий читаемый код вида XXXX-XXXX без похожих символов
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function tokenFromReq(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return typeof req.query.token === 'string' ? req.query.token : null;
}

export function requireAuth(req, res, next) {
  const user = userByToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ error: 'Нужно войти в аккаунт' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Только для админа' });
    next();
  });
}
