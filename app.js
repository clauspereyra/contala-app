// Contala · servidor principal (Node.js + Express + MySQL). Compatible con "Setup Node.js App" de cPanel.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Carga opcional de .env (para desarrollo local; en cPanel se usan las variables de la app Node).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { q, one, migrate } = require('./src/db');
const ai = require('./src/ai');

const app = express();
app.set('trust proxy', 1);
// BASE_PATH: vacío si la app está en la raíz de un (sub)dominio; "/contala" si está en una subcarpeta.
const BASE = ('/' + (process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '');
const r = express.Router();
const DAILY_LIMIT = Number(process.env.DAILY_AI_LIMIT || 60);
const rid = n => crypto.randomBytes(n).toString('hex').slice(0, n);
const RESERVED = new Set(['api', 'app', 'admin', 'www', 'contala', 'login', 'sdk', 'assets']);

app.use(cookieSession({
  name: 'contala',
  secret: process.env.SESSION_SECRET || 'cambiar-esta-clave',
  maxAge: 30 * 24 * 3600 * 1000,
  sameSite: 'lax',
  httpOnly: true,
  path: BASE || '/',
}));

const origin = req => `${req.protocol}://${req.get('host')}${BASE}`;
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const auth = (req, res, next) => (req.session.uid ? next() : res.status(401).json({ error: 'Tenés que ingresar.' }));
async function ownProject(req) {
  const p = await one('SELECT * FROM projects WHERE id=? AND user_id=?', [req.params.id, req.session.uid]);
  if (!p) { const e = new Error('No encontramos esa app.'); e.status = 404; throw e; }
  return p;
}
const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^(lic|dra|dr)\.?\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// Inserta el SDK de datos en la app generada.
function withSdk(html, req, publicId) {
  const tag = `<script src="${origin(req)}/sdk.js" data-app="${publicId}" data-base="${origin(req)}"></script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html;
}

/* ---------- Cuentas ---------- */
r.post('/api/register', express.json(), wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Completá nombre, mail y contraseña.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
  if (await one('SELECT id FROM users WHERE email=?', [email.toLowerCase()])) return res.status(400).json({ error: 'Ese mail ya tiene una cuenta. Probá ingresar.' });
  const r = await q('INSERT INTO users (email,name,password_hash) VALUES (?,?,?)', [email.toLowerCase(), name.slice(0, 120), await bcrypt.hash(password, 10)]);
  req.session.uid = r.insertId;
  res.json({ ok: true });
}));
r.post('/api/login', express.json(), wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE email=?', [String(email || '').toLowerCase()]);
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return res.status(400).json({ error: 'Mail o contraseña incorrectos.' });
  req.session.uid = u.id;
  res.json({ ok: true });
}));
r.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
r.get('/api/me', wrap(async (req, res) => {
  if (!req.session.uid) return res.json({ user: null });
  const u = await one('SELECT id,name,email FROM users WHERE id=?', [req.session.uid]);
  res.json({ user: u, ai: ai.provider() });
}));

/* ---------- Proyectos ---------- */
r.get('/api/projects', auth, wrap(async (req, res) => {
  res.json(await q(`SELECT p.id,p.name,p.slug,p.published_at,p.updated_at,(p.published_html IS NOT NULL) live,
    (SELECT MAX(n) FROM versions v WHERE v.project_id=p.id) ver FROM projects p WHERE user_id=? ORDER BY updated_at DESC`, [req.session.uid]));
}));
r.post('/api/projects', auth, express.json(), wrap(async (req, res) => {
  const r = await q('INSERT INTO projects (user_id,public_id,name) VALUES (?,?,?)', [req.session.uid, rid(16), 'Nueva app']);
  res.json({ id: r.insertId });
}));
r.get('/api/projects/:id', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const messages = await q('SELECT role,content,meta,created_at FROM messages WHERE project_id=? ORDER BY id', [p.id]);
  const versions = await q('SELECT id,n,note,published,created_at FROM versions WHERE project_id=? ORDER BY n DESC', [p.id]);
  res.json({
    id: p.id, name: p.name, slug: p.slug, live: !!p.published_html, published_at: p.published_at,
    html: p.draft_html ? withSdk(p.draft_html, req, p.public_id) : null,
    url: p.slug ? `${origin(req)}/app/${p.slug}` : null,
    messages: messages.map(m => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })), versions,
  });
}));
r.patch('/api/projects/:id', auth, express.json(), wrap(async (req, res) => {
  const p = await ownProject(req);
  const name = String(req.body?.name || '').trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: 'Escribí un nombre.' });
  await q('UPDATE projects SET name=? WHERE id=?', [name, p.id]);
  res.json({ ok: true });
}));
r.delete('/api/projects/:id', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  for (const t of ['messages', 'versions', 'records']) await q(`DELETE FROM ${t} WHERE project_id=?`, [p.id]);
  await q('DELETE FROM projects WHERE id=?', [p.id]);
  res.json({ ok: true });
}));

// Subir imagen (base64, máx. 4 MB)
r.post('/api/uploads', auth, express.json({ limit: '6mb' }), wrap(async (req, res) => {
  const { mime, base64 } = req.body || {};
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime || '') || !base64) return res.status(400).json({ error: 'Subí una imagen PNG, JPG, WEBP o GIF.' });
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'La imagen supera 4 MB.' });
  const token = rid(24);
  await q('INSERT INTO uploads (user_id,token,mime,bytes) VALUES (?,?,?,?)', [req.session.uid, token, mime, buf]);
  res.json({ token, url: `${origin(req)}/u/${token}` });
}));
r.get('/u/:token', wrap(async (req, res) => {
  const f = await one('SELECT mime,bytes FROM uploads WHERE token=?', [req.params.token]);
  if (!f) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=31536000, immutable').type(f.mime).send(f.bytes);
}));

// Charla con la IA
r.post('/api/projects/:id/chat', auth, express.json(), wrap(async (req, res) => {
  const p = await ownProject(req);
  const message = String(req.body?.message || '').trim().slice(0, 4000);
  const tokens = (req.body?.images || []).slice(0, 3);
  if (!message && !tokens.length) return res.status(400).json({ error: 'Escribí tu mensaje.' });

  const day = new Date().toISOString().slice(0, 10);
  const use = await one('SELECT calls FROM ai_usage WHERE user_id=? AND day=?', [req.session.uid, day]);
  if (use && use.calls >= DAILY_LIMIT) return res.status(429).json({ error: `Llegaste al límite de ${DAILY_LIMIT} mensajes por hoy. Seguimos mañana.` });

  const images = [];
  for (const t of tokens) {
    const f = await one('SELECT token,mime,bytes FROM uploads WHERE token=? AND user_id=?', [t, req.session.uid]);
    if (f) images.push({ mime: f.mime, base64: f.bytes.toString('base64'), url: `${origin(req)}/u/${f.token}` });
  }
  const history = (await q("SELECT role,content FROM messages WHERE project_id=? AND role IN ('user','assistant') ORDER BY id DESC LIMIT 12", [p.id])).reverse();
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'user', message || '(imagen)', images.length ? JSON.stringify({ images: images.map(i => i.url) }) : null]);
  await q('INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,1) ON DUPLICATE KEY UPDATE calls=calls+1', [req.session.uid, day]);

  let out;
  try {
    out = await ai.chat({ history, message: message || 'Te mando esta imagen para la app.', currentHtml: p.draft_html, images });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'La IA no respondió. Probá de nuevo en un momento.' });
  }
  let version = null;
  if (out.html) {
    const last = await one('SELECT MAX(n) n FROM versions WHERE project_id=?', [p.id]);
    version = (last?.n || 0) + 1;
    await q('INSERT INTO versions (project_id,n,html,note) VALUES (?,?,?,?)', [p.id, version, out.html, message.slice(0, 250) || 'Imagen agregada']);
    await q('UPDATE projects SET draft_html=? WHERE id=?', [out.html, p.id]);
  }
  if (out.title && p.name === 'Nueva app') await q('UPDATE projects SET name=? WHERE id=?', [out.title, p.id]);
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'assistant', out.reply, JSON.stringify({ suggestions: out.suggestions, version })]);
  await q('UPDATE projects SET updated_at=NOW() WHERE id=?', [p.id]);
  res.json({ reply: out.reply, suggestions: out.suggestions, version, html: out.html ? withSdk(out.html, req, p.public_id) : null, name: out.title });
}));

// Volver a una versión (queda como borrador; si la app está publicada, se publica)
r.post('/api/projects/:id/restore/:vid', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const v = await one('SELECT * FROM versions WHERE id=? AND project_id=?', [req.params.vid, p.id]);
  if (!v) return res.status(404).json({ error: 'Versión no encontrada.' });
  const last = await one('SELECT MAX(n) n FROM versions WHERE project_id=?', [p.id]);
  await q('INSERT INTO versions (project_id,n,html,note) VALUES (?,?,?,?)', [p.id, last.n + 1, v.html, `Volviste a la versión ${v.n}`]);
  await q('UPDATE projects SET draft_html=? WHERE id=?', [v.html, p.id]);
  await q('INSERT INTO messages (project_id,role,content) VALUES (?,?,?)', [p.id, 'note', `Volviste a la versión ${v.n}`]);
  res.json({ ok: true });
}));

// Publicar
r.get('/api/slug-check', auth, wrap(async (req, res) => {
  const s = slugify(String(req.query.s || ''));
  const isTaken = async x => !x || RESERVED.has(x) || !!(await one('SELECT id FROM projects WHERE slug=? AND id<>?', [x, req.query.id || 0]));
  const taken = await isTaken(s);
  let suggestion = null;
  if (taken && s) for (let i = 2; i < 50 && !suggestion; i++) { const c = `${s.slice(0, 46)}-${i}`; if (!(await isTaken(c))) suggestion = c; }
  res.json({ slug: s, available: !taken, suggestion });
}));
r.post('/api/projects/:id/publish', auth, express.json(), wrap(async (req, res) => {
  const p = await ownProject(req);
  if (!p.draft_html) return res.status(400).json({ error: 'Primero armemos la app en la charla.' });
  const s = slugify(String(req.body?.slug || p.slug || p.name));
  if (!s || RESERVED.has(s)) return res.status(400).json({ error: 'Elegí otra dirección.' });
  const other = await one('SELECT id FROM projects WHERE slug=? AND id<>?', [s, p.id]);
  if (other) return res.status(400).json({ error: 'Esa dirección ya está en uso. Probá otra.' });
  await q('UPDATE projects SET slug=?, published_html=draft_html, published_at=NOW() WHERE id=?', [s, p.id]);
  await q('UPDATE versions SET published=0 WHERE project_id=?', [p.id]);
  await q('UPDATE versions SET published=1 WHERE project_id=? ORDER BY n DESC LIMIT 1', [p.id]);
  await q('INSERT INTO messages (project_id,role,content) VALUES (?,?,?)', [p.id, 'note', `Publicada en /app/${s}`]);
  res.json({ ok: true, slug: s, url: `${origin(req)}/app/${s}` });
}));
r.post('/api/projects/:id/unpublish', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  await q('UPDATE projects SET published_html=NULL WHERE id=?', [p.id]);
  res.json({ ok: true });
}));

// Datos que guardan las apps (vista del dueño)
r.get('/api/projects/:id/records', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const rows = await q('SELECT id,collection,data,created_at FROM records WHERE project_id=? ORDER BY id DESC LIMIT 500', [p.id]);
  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
}));

/* ---------- API pública para las apps generadas ---------- */
r.use('/api/public', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const pub = async id => one('SELECT id FROM projects WHERE public_id=?', [id]);
const okCol = c => /^[a-z0-9_]{1,60}$/.test(c);
r.post('/api/public/:pid/:col', express.text({ type: '*/*', limit: '20kb' }), wrap(async (req, res) => {
  const p = await pub(req.params.pid);
  if (!p || !okCol(req.params.col)) return res.status(404).json({ error: 'App no encontrada.' });
  let data; try { data = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'Datos inválidos.' }); }
  const n = await one('SELECT COUNT(*) c FROM records WHERE project_id=?', [p.id]);
  if (n.c >= 5000) return res.status(429).json({ error: 'Esta app llegó al máximo de registros de prueba.' });
  const r = await q('INSERT INTO records (project_id,collection,data) VALUES (?,?,?)', [p.id, req.params.col, JSON.stringify(data)]);
  res.json({ ok: true, id: r.insertId });
}));
r.get('/api/public/:pid/:col', wrap(async (req, res) => {
  const p = await pub(req.params.pid);
  if (!p || !req.params.col.startsWith('public_') || !okCol(req.params.col)) return res.status(403).json({ error: 'Solo se pueden leer colecciones públicas.' });
  const rows = await q('SELECT id,data,created_at FROM records WHERE project_id=? AND collection=? ORDER BY id DESC LIMIT 200', [p.id, req.params.col]);
  res.json(rows.map(r => ({ id: r.id, created_at: r.created_at, ...JSON.parse(r.data) })));
}));
r.get('/sdk.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(`(function(){
var s=document.currentScript,app=s.getAttribute('data-app'),base=s.getAttribute('data-base');
async function call(m,c,d){var r=await fetch(base+'/api/public/'+app+'/'+c,{method:m,headers:{'Content-Type':'text/plain'},body:d?JSON.stringify(d):undefined});var j=await r.json();if(!r.ok)throw new Error(j.error||'Error');return j}
window.contala={save:function(c,d){return call('POST',c,d)},list:function(c){return call('GET',c)}};
})();`);
});

/* ---------- Apps publicadas ---------- */
r.get('/app/:slug', wrap(async (req, res) => {
  const p = await one('SELECT public_id,published_html FROM projects WHERE slug=?', [req.params.slug]);
  if (!p || !p.published_html) return res.status(404).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Esta app no existe o no está publicada</h1><p><a href="${BASE}/">Creá la tuya en Contala</a></p>`);
  // Sandbox: la app corre aislada y no puede leer la sesión de Contala.
  res.set('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
  res.type('html').send(withSdk(p.published_html, req, p.public_id));
}));

/* ---------- Plataforma ---------- */
const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/__BASE__/g, BASE);
r.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));
r.get(['/', '/apps', '/apps/*'], (req, res) => res.type('html').send(indexHtml));
app.use(BASE || '/', r);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Algo salió mal. Probá de nuevo.' });
});

const port = process.env.PORT || 3000;
migrate()
  .then(() => app.listen(port, () => console.log(`Contala en el puerto ${port}${BASE ? ' · ruta ' + BASE : ''} · IA: ${ai.provider()}`)))
  .catch(e => { console.error('No se pudo conectar a MySQL:', e.message); process.exit(1); });
