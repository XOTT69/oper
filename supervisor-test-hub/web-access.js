const browserCookie = '__Host-test-hub-session';
const browserSessionSeconds = 30 * 24 * 60 * 60;
const browserAccessReady = new WeakMap();

function ensureBrowserAccess(db) {
  if (!browserAccessReady.has(db)) {
    browserAccessReady.set(db, db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS th_web_credentials (user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL)'),
      db.prepare('CREATE TABLE IF NOT EXISTS th_web_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)')
    ]).then(() => db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS th_web_sessions_user ON th_web_sessions(user_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS th_web_sessions_expiry ON th_web_sessions(expires_at)')
    ])).catch(error => {
      browserAccessReady.delete(db);
      throw error;
    }));
  }
  return browserAccessReady.get(db);
}

function browserHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function browserDigest(value) {
  return browserHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function browserSessionToken(req) {
  const entry = (req.headers.get('Cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(browserCookie + '='));
  const token = entry?.slice(browserCookie.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}

function browserResponse(token, maxAge) {
  const response = J({ ok: true });
  response.headers.set('Set-Cookie', browserCookie + '=' + token + '; Max-Age=' + maxAge + '; Path=/; Secure; HttpOnly; SameSite=Strict');
  return response;
}

function sameBrowserOrigin(req) {
  return req.headers.get('Origin') === new URL(req.url).origin;
}

async function resolveBrowserSession(req, db) {
  const token = browserSessionToken(req);
  if (!token) return null;
  await ensureBrowserAccess(db);
  return db.prepare('SELECT user_id FROM th_web_sessions WHERE token_hash=? AND expires_at>?')
    .bind(await browserDigest(token), Math.floor(Date.now() / 1000)).first();
}

async function setupBrowserPassword(req, env) {
  let user;
  try { user = await auth(req, env); }
  catch { return J({ error: 'Відкрийте вебпанель у Telegram ще раз.' }, 401); }
  if (!admin(env, user)) return J({ error: 'Доступ тільки супервайзеру.' }, 403);
  // Only credentials generated here are accepted. They contain 160 random bits.
  const password = browserHex(crypto.getRandomValues(new Uint8Array(20)));
  const hash = await browserDigest(password);
  await ensureBrowserAccess(env.DB);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO th_web_credentials(user_id,password_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash').bind(user, hash),
    env.DB.prepare('DELETE FROM th_web_sessions WHERE user_id=?').bind(user)
  ]);
  return J({ login: user, password });
}

async function browserLogin(req, env) {
  const invalid = () => J({ error: 'Невірний логін або вебпароль.' }, 401);
  const body = await req.json().catch(() => null);
  const login = typeof body?.login === 'string' ? body.login.trim() : '';
  const password = typeof body?.password === 'string' ? body.password.trim() : '';
  if (!/^\d{1,16}$/.test(login) || !/^[a-f0-9]{40}$/.test(password) || !admin(env, login)) return invalid();
  const db = env.DB;
  await ensureBrowserAccess(db);
  const now = Math.floor(Date.now() / 1000);
  const token = browserHex(crypto.getRandomValues(new Uint8Array(32)));
  const passwordHash = await browserDigest(password);
  const tokenHash = await browserDigest(token);
  // Match the current credential and create its session in one statement.
  const created = await db.prepare('INSERT INTO th_web_sessions(token_hash,user_id,expires_at) SELECT ?,user_id,? FROM th_web_credentials WHERE user_id=? AND password_hash=?')
    .bind(tokenHash, now + browserSessionSeconds, login, passwordHash).run();
  if (!created.meta.changes) return invalid();
  await db.prepare('DELETE FROM th_web_sessions WHERE expires_at<=?').bind(now).run();
  return browserResponse(token, browserSessionSeconds);
}

async function browserAccessApi(req, env, path) {
  if (req.method !== 'POST') return J({ error: 'Метод не підтримується.' }, 405);
  if (!sameBrowserOrigin(req)) return J({ error: 'Відкрийте сторінку входу на цьому сайті.' }, 403);
  if (path === '/api/web-access/setup') return setupBrowserPassword(req, env);
  if (path === '/api/web-access/login') {
    if (!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) return J({ error: 'Некоректний запит.' }, 415);
    const size = Number(req.headers.get('Content-Length'));
    if (size > 1024) return J({ error: 'Некоректний запит.' }, 413);
    return browserLogin(req, env);
  }
  if (path === '/api/web-access/logout') {
    const token = browserSessionToken(req);
    if (token) {
      await ensureBrowserAccess(env.DB);
      await env.DB.prepare('DELETE FROM th_web_sessions WHERE token_hash=?').bind(await browserDigest(token)).run();
    }
    return browserResponse('', 0);
  }
  return J({ error: 'Сторінку не знайдено.' }, 404);
}
