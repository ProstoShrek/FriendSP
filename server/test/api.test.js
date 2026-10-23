import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundpad-test-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

let base;
let server;

before(async () => {
  ({ server } = await import('../src/index.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const call = async (method, url, { token, body, form } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

// Минимальный WAV на 0.1 с
function wav(seed) {
  const samples = 2205;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(22050, 24); buf.writeUInt32LE(44100, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin(i * seed) * 8000), 44 + i * 2);
  return buf;
}

test('первый пользователь — админ, остальные только по инвайту', async () => {
  const admin = await call('POST', '/api/register', { body: { username: 'Павел', password: 'pass1' } });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.isAdmin, true);

  const noInvite = await call('POST', '/api/register', { body: { username: 'друг', password: 'pass1' } });
  assert.equal(noInvite.status, 400);

  const { data: { code } } = await call('POST', '/api/admin/invites', { token: admin.data.token });
  const friend = await call('POST', '/api/register', { body: { username: 'друг', password: 'pass1', invite: code.toLowerCase() } });
  assert.equal(friend.status, 200);
  assert.equal(friend.data.user.isAdmin, false);

  const reuse = await call('POST', '/api/register', { body: { username: 'друг2', password: 'pass1', invite: code } });
  assert.equal(reuse.status, 400, 'инвайт одноразовый');

  const forbidden = await call('POST', '/api/admin/invites', { token: friend.data.token });
  assert.equal(forbidden.status, 403);
});

test('загрузка, дубликаты, права на удаление', async () => {
  const admin = (await call('POST', '/api/login', { body: { username: 'павел', password: 'pass1' } })).data.token;
  const friend = (await call('POST', '/api/login', { body: { username: 'друг', password: 'pass1' } })).data.token;

  const form = new FormData();
  form.append('files', new Blob([wav(0.05)]), 'Бруh.wav');
  form.append('files', new Blob([wav(0.05)]), 'копия.wav');
  form.append('files', new Blob([Buffer.from('nope')]), 'readme.txt');
  form.append('categories', 'Мемы');
  const up = await call('POST', '/api/sounds', { token: friend, form });
  assert.equal(up.status, 200);
  assert.equal(up.data.added.length, 1);
  assert.equal(up.data.added[0].name, 'Бруh');
  assert.equal(up.data.added[0].category, 'Мемы');
  assert.equal(up.data.duplicates, 1);
  assert.equal(up.data.errors.length, 1);

  const id = up.data.added[0].id;
  const file = await fetch(`${base}/api/sounds/${id}/file`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(file.status, 200);
  assert.equal((await file.arrayBuffer()).byteLength, wav(0.05).length);

  const form2 = new FormData();
  form2.append('files', new Blob([wav(0.09)]), 'админский.wav');
  const adminSound = (await call('POST', '/api/sounds', { token: admin, form: form2 })).data.added[0];
  assert.equal((await call('DELETE', `/api/sounds/${adminSound.id}`, { token: friend })).status, 403);
  assert.equal((await call('PATCH', `/api/sounds/${id}`, { token: friend, body: { name: 'Bruh!', volume: 5 } })).data.sound.volume, 2);
  assert.equal((await call('DELETE', `/api/sounds/${id}`, { token: admin })).status, 200);

  const list = await call('GET', '/api/sounds', { token: friend });
  assert.deepEqual(list.data.sounds.map((s) => s.name), ['админский']);
});

test('импорт из папки на сервере', async () => {
  const admin = (await call('POST', '/api/login', { body: { username: 'Павел', password: 'pass1' } })).data.token;
  fs.mkdirSync(path.join(dataDir, 'import', 'Игры'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'import', 'Игры', 'победа.wav'), wav(0.2));
  fs.writeFileSync(path.join(dataDir, 'import', 'корень.wav'), wav(0.3));

  const scan = await call('GET', '/api/admin/server-import', { token: admin });
  assert.deepEqual(scan.data.files.map((f) => [f.path, f.category]), [['Игры/победа.wav', 'Игры'], ['корень.wav', '']]);

  const escape = await call('POST', '/api/admin/server-import', { token: admin, body: { paths: ['../soundpad.db'] } });
  assert.equal(escape.data.added, 0);
  assert.equal(escape.data.errors.length, 1);

  const imp = await call('POST', '/api/admin/server-import', { token: admin, body: {} });
  assert.equal(imp.data.added, 2);
  const again = await call('POST', '/api/admin/server-import', { token: admin, body: {} });
  assert.equal(again.data.duplicates, 2);
});
