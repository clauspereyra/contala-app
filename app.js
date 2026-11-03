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
const mail = require('./src/mail');
const vac = require('./src/vac');
const inst = require('./src/inst');
const sdr = require('./src/sdr');
const nightly = require('./src/nightly');
const crawler = require('./src/crawl');

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

/* ---------- Dominios propios: si entran por el dominio del cliente, se muestra su app ---------- */
const PLATFORM_HOSTS = new Set(String(process.env.PLATFORM_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const bareHost = h => String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
app.use(async (req, res, next) => {
  try {
    const host = bareHost(req.get('host'));
    if (!host || PLATFORM_HOSTS.has(host) || /^(localhost|127\.|\d+\.\d+\.\d+\.\d+$)/.test(host)) return next();
    const d = await one("SELECT d.id,d.status,p.public_id,p.published_html FROM custom_domains d JOIN projects p ON p.id=d.project_id WHERE d.domain=?", [host]);
    if (!d) return next();
    // Recursos que la app necesita (datos, imágenes, SDK) siguen por el camino normal.
    if (/^\/(sdk\.js|api\/public\/|u\/)/.test(req.path.slice(BASE.length) || req.path)) return next();
    if (d.status === 'dns_ok') await q("UPDATE custom_domains SET status='activo' WHERE id=?", [d.id]);
    if (!d.published_html) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Esta app todavía no está publicada</h1>');
    res.set('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
    return res.type('html').send(withSdk(d.published_html, req, d.public_id, 'live'));
  } catch (e) { next(e); }
});

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
function withSdk(html, req, publicId, mode = 'preview') {
  const tag = `<script src="${origin(req)}/sdk.js" data-app="${publicId}" data-base="${origin(req)}" data-mode="${mode}"></script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html;
}

/* ---------- Memoria del negocio ---------- */
async function getBusiness(uid) {
  const b = await one('SELECT profile FROM business WHERE user_id=?', [uid]);
  try { return b ? JSON.parse(b.profile) : {}; } catch { return {}; }
}
async function saveBusiness(uid, patch) {
  const cur = await getBusiness(uid);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete cur[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k])) cur[k] = { ...cur[k], ...v };
    else cur[k] = v;
  }
  const json = JSON.stringify(cur).slice(0, 100000);
  await q('INSERT INTO business (user_id,profile) VALUES (?,?) ON DUPLICATE KEY UPDATE profile=VALUES(profile)', [uid, json]);
}

/* ---------- Equipo de expertos (personas reales de Contala) ---------- */
const EXPERTS = () => String(process.env.EXPERT_EMAILS || process.env.ADMIN_EMAIL || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const isExpertEmail = e => !!e && EXPERTS().includes(String(e).toLowerCase());
async function openHelp(req, { userId, projectId, reason, message }) {
  const open = await one("SELECT id FROM help_requests WHERE project_id<=>? AND user_id=? AND status<>'resuelta' ORDER BY id DESC LIMIT 1", [projectId, userId]);
  if (open) { if (message) await q('UPDATE help_requests SET message=CONCAT(COALESCE(message,""),?) WHERE id=?', ['\n— ' + message.slice(0, 1000), open.id]); return open.id; }
  const r = await q('INSERT INTO help_requests (user_id,project_id,reason,message) VALUES (?,?,?,?)', [userId, projectId, reason, (message || '').slice(0, 2000) || null]);
  const u = await one('SELECT name,email FROM users WHERE id=?', [userId]);
  const p = projectId ? await one('SELECT name FROM projects WHERE id=?', [projectId]) : null;
  const why = { pedido: 'pidió ayuda', ia_fallo: 'la IA falló varias veces', complejo: 'proyecto complejo' }[reason] || reason;
  for (const to of EXPERTS()) mail.send({ to, fromName: 'Contala', subject: `Ayuda: ${u.name} (${why})`, html: `<p><b>${u.name}</b> &lt;${u.email}&gt; · ${why}${p ? ` · app "${p.name}"` : ''}</p>${message ? `<p>${String(message).replace(/[<>&]/g, '')}</p>` : ''}<p><a href="${origin(req)}/expertos">Abrir panel de expertos</a></p>` }).catch(() => {});
  return r.insertId;
}
const iaFails = new Map(); // proyecto → fallos recientes de la IA

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
  const flags = (await q('SELECT flag FROM user_flags WHERE user_id=?', [req.session.uid])).map(f => f.flag);
  res.json({ user: u, flags, ai: ai.provider(), isExpert: isExpertEmail(u?.email) });
}));
// Guía: marcar pasos ya vistos (tour, consejos)
r.post('/api/flags', auth, express.json(), wrap(async (req, res) => {
  const flag = String(req.body?.flag || '');
  if (!/^[a-z0-9_-]{1,40}$/.test(flag)) return res.status(400).json({ error: 'Dato inválido.' });
  if (req.body?.off) await q('DELETE FROM user_flags WHERE user_id=? AND flag=?', [req.session.uid, flag]);
  else await q('INSERT IGNORE INTO user_flags (user_id,flag) VALUES (?,?)', [req.session.uid, flag]);
  res.json({ ok: true });
}));

r.get('/api/business', auth, wrap(async (req, res) => res.json(await getBusiness(req.session.uid))));

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

// Subir imagen o PDF (base64, máx. 8 MB)
r.post('/api/uploads', auth, express.json({ limit: '12mb' }), wrap(async (req, res) => {
  const { mime, base64 } = req.body || {};
  if (!/^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/.test(mime || '') || !base64) return res.status(400).json({ error: 'Subí una imagen (PNG, JPG, WEBP, GIF) o un PDF.' });
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'El archivo supera 8 MB.' });
  const token = rid(24);
  await q('INSERT INTO uploads (user_id,token,mime,bytes) VALUES (?,?,?,?)', [req.session.uid, token, mime, buf]);
  res.json({ token, mime, url: `${origin(req)}/u/${token}` });
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
  const files = (req.body?.images || []).slice(0, 5).map(x => (typeof x === 'string' ? { token: x } : x));
  if (!message && !files.length) return res.status(400).json({ error: 'Escribí tu mensaje.' });

  const day = new Date().toISOString().slice(0, 10);
  const use = await one('SELECT calls FROM ai_usage WHERE user_id=? AND day=?', [req.session.uid, day]);
  if (use && use.calls >= DAILY_LIMIT) return res.status(429).json({ error: `Llegaste al límite de ${DAILY_LIMIT} mensajes por hoy. Seguimos mañana.` });

  const images = [];
  for (const f0 of files) {
    const f = await one('SELECT token,mime,bytes FROM uploads WHERE token=? AND user_id=?', [String(f0.token || ''), req.session.uid]);
    if (f) images.push({ mime: f.mime, base64: f.bytes.toString('base64'), url: `${origin(req)}/u/${f.token}`, name: String(f0.name || '').slice(0, 120) });
  }
  const history = (await q("SELECT role,content,meta FROM messages WHERE project_id=? AND role IN ('user','assistant') ORDER BY id DESC LIMIT 12", [p.id])).reverse()
    .map(m => {
      let content = m.content;
      try { const ideas = m.meta ? JSON.parse(m.meta).ideas : null; if (ideas?.length) content += '\n(Ideas que ya propuse: ' + ideas.map(i => i.title).join('; ') + ')'; } catch {}
      return { role: m.role, content };
    });
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'user', message || '(archivo)', images.length ? JSON.stringify({ files: images.map(i => ({ url: i.url, mime: i.mime, name: i.name })) }) : null]);
  await q('INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,1) ON DUPLICATE KEY UPDATE calls=calls+1', [req.session.uid, day]);

  let out;
  try {
    out = await ai.chat({ history, message: message || 'Te mando este archivo para la app.', currentHtml: p.draft_html, images, business: await getBusiness(req.session.uid) });
  } catch (e) {
    console.error(e);
    const f = (iaFails.get(p.id) || []).filter(t => Date.now() - t < 3600e3); f.push(Date.now()); iaFails.set(p.id, f);
    if (f.length >= 2) { await openHelp(req, { userId: req.session.uid, projectId: p.id, reason: 'ia_fallo', message: 'Último pedido: ' + message }); return res.status(502).json({ error: 'La IA no pudo responder otra vez. Ya le avisamos a nuestro equipo: una persona va a revisar tu app y te escribe acá.' }); }
    return res.status(502).json({ error: 'La IA no respondió. Probá de nuevo en un momento.' });
  }
  if (out.memory) await saveBusiness(req.session.uid, out.memory);
  let version = null;
  if (out.html) {
    const last = await one('SELECT MAX(n) n FROM versions WHERE project_id=?', [p.id]);
    version = (last?.n || 0) + 1;
    await q('INSERT INTO versions (project_id,n,html,note) VALUES (?,?,?,?)', [p.id, version, out.html, message.slice(0, 250) || 'Imagen agregada']);
    await q('UPDATE projects SET draft_html=? WHERE id=?', [out.html, p.id]);
  }
  if (out.title && p.name === 'Nueva app') await q('UPDATE projects SET name=? WHERE id=?', [out.title, p.id]);
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'assistant', out.reply, JSON.stringify({ suggestions: out.suggestions, ideas: out.ideas, version, memory: !!out.memory })]);
  await q('UPDATE projects SET updated_at=NOW() WHERE id=?', [p.id]);
  res.json({ reply: out.reply, suggestions: out.suggestions, ideas: out.ideas, memory: !!out.memory, version, html: out.html ? withSdk(out.html, req, p.public_id) : null, name: out.title });
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

/* ---------- Notificaciones y sugerencias ---------- */
r.get('/api/notifications', auth, wrap(async (req, res) => {
  const rows = await q(`SELECT n.id,n.kind,n.title,n.body,n.ask,n.status,n.created_at,n.project_id,p.name project FROM notifications n LEFT JOIN projects p ON p.id=n.project_id
    WHERE n.user_id=? AND n.status IN ('nueva','leida','luego') ORDER BY n.id DESC LIMIT 50`, [req.session.uid]);
  const flags = (await q("SELECT flag FROM user_flags WHERE user_id=? AND flag IN ('notif_off','digest_off')", [req.session.uid])).map(f => f.flag);
  res.json({ rows, unread: rows.filter(r => r.status === 'nueva').length, prefs: { suggestions: !flags.includes('notif_off'), digest: !flags.includes('digest_off') } });
}));
r.post('/api/notifications/read', auth, wrap(async (req, res) => {
  await q("UPDATE notifications SET status='leida' WHERE user_id=? AND status='nueva'", [req.session.uid]); res.json({ ok: true });
}));
r.post('/api/notifications/:id', auth, express.json(), wrap(async (req, res) => {
  const st = ['aplicada', 'descartada', 'luego', 'leida'].includes(req.body?.status) ? req.body.status : null;
  if (!st) return res.status(400).json({ error: 'Dato inválido.' });
  await q('UPDATE notifications SET status=? WHERE id=? AND user_id=?', [st, req.params.id, req.session.uid]); res.json({ ok: true });
}));
r.post('/api/notification-prefs', auth, express.json(), wrap(async (req, res) => {
  for (const [k, flag] of [['suggestions', 'notif_off'], ['digest', 'digest_off']]) {
    if (req.body?.[k] === undefined) continue;
    if (req.body[k]) await q('DELETE FROM user_flags WHERE user_id=? AND flag=?', [req.session.uid, flag]);
    else await q('INSERT IGNORE INTO user_flags (user_id,flag) VALUES (?,?)', [req.session.uid, flag]);
  }
  res.json({ ok: true });
}));
// "Revisar mi app": la misma revisión del equipo, pedida en el momento.
r.post('/api/projects/:id/review', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  if (!p.draft_html) return res.status(400).json({ error: 'Primero armemos la app en la charla.' });
  const day = new Date().toISOString().slice(0, 10);
  const use = await one('SELECT calls FROM ai_usage WHERE user_id=? AND day=?', [req.session.uid, day]);
  if (use && use.calls >= DAILY_LIMIT) return res.status(429).json({ error: `Llegaste al límite de ${DAILY_LIMIT} mensajes por hoy.` });
  await q('INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,1) ON DUPLICATE KEY UPDATE calls=calls+1', [req.session.uid, day]);
  let news;
  try { news = await nightly.reviewProject(p, { limit: 3 }); } catch (e) { console.error(e); return res.status(502).json({ error: 'No pude revisar la app ahora. Probá en un momento.' }); }
  res.json({ suggestions: news });
}));
// Estudiar y mejorar: la persona pega un link de referencia; Contala recorre el sitio y propone qué hacer igual o mejor.
r.post('/api/projects/:id/study', auth, express.json(), wrap(async (req, res) => {
  const p = await ownProject(req);
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  const url = crawler.findUrls(message)[0];
  if (!url) return res.status(400).json({ error: 'Pegá el link de la página que querés estudiar.' });
  const day = new Date().toISOString().slice(0, 10);
  const use = await one('SELECT calls FROM ai_usage WHERE user_id=? AND day=?', [req.session.uid, day]);
  if (use && use.calls + 2 > DAILY_LIMIT) return res.status(429).json({ error: `Llegaste al límite de ${DAILY_LIMIT} mensajes por hoy.` });
  await q('INSERT INTO messages (project_id,role,content) VALUES (?,?,?)', [p.id, 'user', message]);
  const c = await crawler.crawl(url);
  if (c.error) {
    const reply = `${c.error} Si querés, mandame capturas de pantalla de las partes que te gustan (con el clip) y lo estudio igual.`;
    await q('INSERT INTO messages (project_id,role,content) VALUES (?,?,?)', [p.id, 'assistant', reply]);
    return res.json({ reply, study: null });
  }
  await q('INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,2) ON DUPLICATE KEY UPDATE calls=calls+2', [req.session.uid, day]);
  let st;
  try { st = await ai.study({ crawl: c, message, business: await getBusiness(req.session.uid), html: p.draft_html }); }
  catch (e) { console.error(e); return res.status(502).json({ error: 'No pude terminar el análisis ahora. Probá en un momento.' }); }
  st.paginas = c.pages.map(x => x.url); st.thin = c.thin;
  const reply = `Recorrí ${c.pages.length} ${c.pages.length === 1 ? 'página' : 'páginas'} de ${st.sitio}. ${st.resumen}${c.thin ? ' Ojo: el sitio mostró poco contenido; con capturas de pantalla el análisis sale mejor.' : ''}\n(Estudio del sitio: funciones ${st.funciones.join('; ')}. A mejorar: ${st.mejorar.join('; ')}.)`;
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'assistant', reply, JSON.stringify({ study: st })]);
  res.json({ reply, study: st });
}));

// Pedir ayuda a una persona del equipo
r.post('/api/projects/:id/help', auth, express.json(), wrap(async (req, res) => {
  const p = await ownProject(req);
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  await openHelp(req, { userId: req.session.uid, projectId: p.id, reason: 'pedido', message });
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'note', 'Pediste ayuda a nuestro equipo', JSON.stringify({ help: true })]);
  res.json({ ok: true });
}));

/* ----- Panel de expertos ----- */
const expert = wrap(async (req, res, next) => {
  if (!req.session.uid) return res.status(401).json({ error: 'Tenés que ingresar.' });
  const u = await one('SELECT id,name,email FROM users WHERE id=?', [req.session.uid]);
  if (!isExpertEmail(u?.email)) return res.status(403).json({ error: 'Solo para el equipo de Contala.' });
  req.expert = u; next();
});
r.get('/api/expert/overview', expert, wrap(async (req, res) => {
  const n = async sql => Number((await one(sql)).c);
  res.json({
    users: await n('SELECT COUNT(*) c FROM users'), apps: await n('SELECT COUNT(*) c FROM projects'), live: await n('SELECT COUNT(*) c FROM projects WHERE published_html IS NOT NULL'),
    aiToday: await n('SELECT COALESCE(SUM(calls),0) c FROM ai_usage WHERE day=CURDATE()'), aiWeek: await n('SELECT COALESCE(SUM(calls),0) c FROM ai_usage WHERE day > CURDATE() - INTERVAL 7 DAY'),
    newUsersWeek: await n('SELECT COUNT(*) c FROM users WHERE created_at > NOW() - INTERVAL 7 DAY'), openHelp: await n("SELECT COUNT(*) c FROM help_requests WHERE status<>'resuelta'"),
    vac: await n('SELECT COUNT(*) c FROM vac_orgs'), inst: await n('SELECT COUNT(*) c FROM inst_orgs'), sdr: await n('SELECT COUNT(*) c FROM sdr_orgs'),
  });
}));
r.get('/api/expert/requests', expert, wrap(async (req, res) => {
  res.json(await q(`SELECT h.*,u.name user_name,u.email user_email,p.name project_name,e.name assigned_name FROM help_requests h JOIN users u ON u.id=h.user_id LEFT JOIN projects p ON p.id=h.project_id LEFT JOIN users e ON e.id=h.assigned_to
    ORDER BY (h.status='resuelta'), h.id DESC LIMIT 100`));
}));
r.post('/api/expert/requests/:id', expert, express.json(), wrap(async (req, res) => {
  const st = ['abierta', 'en_curso', 'resuelta'].includes(req.body?.status) ? req.body.status : 'en_curso';
  await q('UPDATE help_requests SET status=?, assigned_to=COALESCE(assigned_to,?) WHERE id=?', [st, req.expert.id, req.params.id]); res.json({ ok: true });
}));
r.get('/api/expert/projects', expert, wrap(async (req, res) => {
  const f = '%' + String(req.query.q || '').slice(0, 60) + '%';
  res.json(await q(`SELECT p.id,p.name,p.slug,(p.published_html IS NOT NULL) live,p.updated_at,u.name user_name,u.email user_email,(SELECT MAX(n) FROM versions v WHERE v.project_id=p.id) ver
    FROM projects p JOIN users u ON u.id=p.user_id WHERE p.name LIKE ? OR u.name LIKE ? OR u.email LIKE ? ORDER BY p.updated_at DESC LIMIT 60`, [f, f, f]));
}));
r.get('/api/expert/projects/:id', expert, wrap(async (req, res) => {
  const p = await one('SELECT p.*,u.name user_name,u.email user_email FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'App no encontrada.' });
  const messages = (await q('SELECT role,content,meta,created_at FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 30', [p.id])).reverse();
  res.json({ id: p.id, name: p.name, user_id: p.user_id, user_name: p.user_name, user_email: p.user_email, slug: p.slug, live: !!p.published_html,
    url: p.slug ? `${origin(req)}/app/${p.slug}` : null, html: p.draft_html ? withSdk(p.draft_html, req, p.public_id) : null,
    messages: messages.map(m => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })), business: await getBusiness(p.user_id),
    domain: await one('SELECT domain,status FROM custom_domains WHERE project_id=?', [p.id]) });
}));
// El experto deja una sugerencia (llega a la campanita como "De nuestro equipo") y/o escribe en la charla.
r.post('/api/expert/projects/:id/suggest', expert, express.json(), wrap(async (req, res) => {
  const p = await one('SELECT id,user_id,name FROM projects WHERE id=?', [req.params.id]); if (!p) return res.status(404).json({ error: 'App no encontrada.' });
  const title = String(req.body?.title || '').trim().slice(0, 200), body = String(req.body?.body || '').trim().slice(0, 2000), ask = String(req.body?.ask || '').trim().slice(0, 1000);
  if (!title) return res.status(400).json({ error: 'Escribí un título.' });
  await q("INSERT INTO notifications (user_id,project_id,kind,title,body,ask) VALUES (?,?,'experto',?,?,?)", [p.user_id, p.id, title, body || null, ask || null]);
  await q('INSERT INTO messages (project_id,role,content,meta) VALUES (?,?,?,?)', [p.id, 'note', `${title}${body ? '\n' + body : ''}`, JSON.stringify({ expert: req.expert.name, ask: ask || null })]);
  const u = await one('SELECT name,email FROM users WHERE id=?', [p.user_id]);
  mail.send({ to: u.email, fromName: 'Equipo Contala', replyTo: req.expert.email, subject: `${req.expert.name.split(' ')[0]} del equipo de Contala revisó tu app`, html: `<p>Hola ${u.name.split(' ')[0]}, revisamos tu app <b>${p.name}</b> y te dejamos esto:</p><p><b>${title.replace(/[<>&]/g, '')}</b><br>${body.replace(/[<>&]/g, '').replace(/\n/g, '<br>')}</p><p><a href="${origin(req)}/apps/${p.id}">Ver en Contala</a></p><p style="color:#6a727c">— ${req.expert.name}, equipo de Contala</p>` }).catch(() => {});
  await q("UPDATE help_requests SET status=IF(status='abierta','en_curso',status), assigned_to=COALESCE(assigned_to,?) WHERE project_id=? AND status<>'resuelta'", [req.expert.id, p.id]);
  res.json({ ok: true });
}));

// Dominio propio (fase 1: el cliente apunta su dominio; nuestro equipo lo agrega como alias en cPanel y se activa el candado).
const dnsP = require('dns').promises;
const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
async function serverIps(req) {
  const h = req.get('host').replace(/:\d+$/, '');
  const fixed = String(process.env.SERVER_IP || '').split(',').map(x => x.trim()).filter(Boolean);
  if (fixed.length) return fixed;
  return (await dnsP.resolve4(h).catch(() => []));
}
r.get('/api/projects/:id/domain', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const d = await one('SELECT domain,status,created_at,verified_at FROM custom_domains WHERE project_id=?', [p.id]);
  res.json({ domain: d, target: req.get('host').replace(/:\d+$/, ''), ips: await serverIps(req) });
}));
r.post('/api/projects/:id/domain', auth, express.json(), wrap(async (req, res) => {
  const p = await ownProject(req);
  if (!p.published_html) return res.status(400).json({ error: 'Primero publicá la app; después le sumamos tu dominio.' });
  const domain = cleanDomain(req.body?.domain);
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) || domain.length > 190) return res.status(400).json({ error: 'Escribí el dominio así: tunegocio.com.ar' });
  if (PLATFORM_HOSTS.has(domain) || bareHost(req.get('host')).endsWith(domain)) return res.status(400).json({ error: 'Ese dominio no se puede usar.' });
  const other = await one('SELECT project_id FROM custom_domains WHERE domain=?', [domain]);
  if (other && other.project_id !== p.id) return res.status(400).json({ error: 'Ese dominio ya está conectado a otra app.' });
  await q("INSERT INTO custom_domains (project_id,domain,status) VALUES (?,?,'pendiente') ON DUPLICATE KEY UPDATE domain=VALUES(domain),status='pendiente',verified_at=NULL", [p.id, domain]);
  res.json({ ok: true, domain });
}));
r.post('/api/projects/:id/domain/verify', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const d = await one('SELECT * FROM custom_domains WHERE project_id=?', [p.id]);
  if (!d) return res.status(400).json({ error: 'Primero escribí tu dominio.' });
  const ips = await serverIps(req), target = req.get('host').replace(/:\d+$/, '');
  const a = await dnsP.resolve4(d.domain).catch(() => []);
  const www = await dnsP.resolveCname('www.' + d.domain).catch(() => []);
  const wwwA = await dnsP.resolve4('www.' + d.domain).catch(() => []);
  const rootOk = a.some(ip => ips.includes(ip));
  const wwwOk = www.some(c => c.replace(/\.$/, '') === target) || wwwA.some(ip => ips.includes(ip));
  if (!rootOk && !wwwOk) return res.json({ ok: false, found: { a, www, wwwA }, message: 'Todavía no vemos el cambio. Los cambios de DNS pueden tardar desde minutos hasta 24 horas en verse. Probá de nuevo en un rato.' });
  if (d.status === 'pendiente') {
    await q("UPDATE custom_domains SET status='dns_ok', verified_at=NOW() WHERE id=?", [d.id]);
    const u = await one('SELECT name,email FROM users WHERE id=?', [req.session.uid]);
    if (process.env.ADMIN_EMAIL) mail.send({ to: process.env.ADMIN_EMAIL, fromName: 'Contala', subject: `Activar dominio: ${d.domain}`,
      html: `<p><b>${d.domain}</b> ya apunta al servidor (app "${p.name}" de ${u.name} &lt;${u.email}&gt;).</p><ol><li>cPanel &gt; Dominios &gt; Crear dominio: <b>${d.domain}</b> (y www) con la misma raíz que ${target}, o como alias.</li><li>SSL/TLS Status &gt; Run AutoSSL para ${d.domain}.</li></ol><p>Apenas entre la primera visita por ese dominio, Contala lo marca como activo.</p>` }).catch(() => {});
  }
  res.json({ ok: true, rootOk, wwwOk, status: d.status === 'pendiente' ? 'dns_ok' : d.status });
}));
r.delete('/api/projects/:id/domain', auth, wrap(async (req, res) => {
  const p = await ownProject(req); await q('DELETE FROM custom_domains WHERE project_id=?', [p.id]); res.json({ ok: true });
}));

// Estudio de mercado del rubro (Investigador de mercado con búsqueda en internet).
r.get('/api/projects/:id/market', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const m = await one('SELECT report,created_at FROM market_studies WHERE project_id=? ORDER BY id DESC LIMIT 1', [p.id]);
  res.json(m ? { ...JSON.parse(m.report), created_at: m.created_at } : null);
}));
r.post('/api/projects/:id/market', auth, wrap(async (req, res) => {
  const p = await ownProject(req);
  const day = new Date().toISOString().slice(0, 10);
  const use = await one('SELECT calls FROM ai_usage WHERE user_id=? AND day=?', [req.session.uid, day]);
  if (use && use.calls + 2 > DAILY_LIMIT) return res.status(429).json({ error: `Llegaste al límite de ${DAILY_LIMIT} mensajes por hoy.` });
  await q('INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,2) ON DUPLICATE KEY UPDATE calls=calls+2', [req.session.uid, day]);
  const history = (await q("SELECT role,content FROM messages WHERE project_id=? AND role='user' ORDER BY id DESC LIMIT 10", [p.id])).reverse();
  let report;
  try { report = await ai.market({ projectName: p.name, business: await getBusiness(req.session.uid), html: p.draft_html, history }); }
  catch (e) { console.error(e); return res.status(502).json({ error: 'No pude terminar la investigación ahora. Probá en un momento.' }); }
  await q('INSERT INTO market_studies (project_id,user_id,report) VALUES (?,?,?)', [p.id, req.session.uid, JSON.stringify(report)]);
  await q('INSERT INTO messages (project_id,role,content) VALUES (?,?,?)', [p.id, 'note', 'Estudio de mercado listo']);
  res.json(report);
}));

// Disparador del Cron Job de cPanel (una vez por día, de madrugada).
r.get('/api/cron/nightly', wrap(async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) return res.status(403).json({ error: 'Clave inválida.' });
  const out = await nightly.runNightly({ origin: origin(req) });
  try { Object.assign(out, await sdr.digest({ origin: origin(req) })); } catch (e) { console.error(e); }
  res.json(out);
}));

/* ---------- Avisos por mail ---------- */
const MAIL_DAILY = Number(process.env.MAIL_DAILY_LIMIT || 200);
async function notify(req, p, collection, data) {
  const day = new Date().toISOString().slice(0, 10);
  const u = await one('SELECT sent FROM mail_usage WHERE project_id=? AND day=?', [p.id, day]);
  if (u && u.sent >= MAIL_DAILY) return console.log(`[mail] límite diario alcanzado en app ${p.id}`);
  const owner = await one('SELECT email,name FROM users WHERE id=?', [p.user_id]);
  const biz = await getBusiness(p.user_id);
  const ownerEmail = biz.email || owner?.email;
  const businessName = biz.nombre || p.name;
  const clientEmail = mail.findEmail(data);
  let sent = 0;
  const a = await mail.send({ to: ownerEmail, fromName: 'Contala', replyTo: clientEmail || undefined,
    subject: `Nuevo registro en ${p.name}`, html: mail.ownerNotice({ appName: p.name, collection, data, panelUrl: `${origin(req)}/apps/${p.id}` }) });
  if (a.id) sent++;
  if (clientEmail) {
    const b = await mail.send({ to: clientEmail, fromName: businessName, replyTo: ownerEmail,
      subject: `${businessName}: recibimos tu mensaje`, html: mail.clientConfirmation({ businessName, collection, contact: biz.whatsapp || ownerEmail }) });
    if (b.id) sent++;
  }
  if (sent) await q('INSERT INTO mail_usage (project_id,day,sent) VALUES (?,?,?) ON DUPLICATE KEY UPDATE sent=sent+VALUES(sent)', [p.id, day, sent]);
}

/* ---------- API pública para las apps generadas ---------- */
r.use('/api/public', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const pub = async id => one('SELECT id,user_id,name FROM projects WHERE public_id=?', [id]);
const okCol = c => /^[a-z0-9_]{1,60}$/.test(c);
r.post('/api/public/:pid/:col', express.text({ type: '*/*', limit: '20kb' }), wrap(async (req, res) => {
  const p = await pub(req.params.pid);
  if (!p || !okCol(req.params.col)) return res.status(404).json({ error: 'App no encontrada.' });
  let data; try { data = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'Datos inválidos.' }); }
  const n = await one('SELECT COUNT(*) c FROM records WHERE project_id=?', [p.id]);
  if (n.c >= 5000) return res.status(429).json({ error: 'Esta app llegó al máximo de registros de prueba.' });
  const r = await q('INSERT INTO records (project_id,collection,data) VALUES (?,?,?)', [p.id, req.params.col, JSON.stringify(data)]);
  res.json({ ok: true, id: r.insertId });
  // Mails solo desde la app publicada (no desde la vista previa) y en colecciones privadas.
  if (req.query.m === 'live' && !req.params.col.startsWith('public_')) notify(req, p, req.params.col, data).catch(e => console.error('[mail]', e.message));
}));
r.get('/api/public/:pid/:col', wrap(async (req, res) => {
  const p = await pub(req.params.pid);
  if (!p || !req.params.col.startsWith('public_') || !okCol(req.params.col)) return res.status(403).json({ error: 'Solo se pueden leer colecciones públicas.' });
  const rows = await q('SELECT id,data,created_at FROM records WHERE project_id=? AND collection=? ORDER BY id DESC LIMIT 200', [p.id, req.params.col]);
  res.json(rows.map(r => ({ id: r.id, created_at: r.created_at, ...JSON.parse(r.data) })));
}));
r.get('/sdk.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(`(function(){
var s=document.currentScript,app=s.getAttribute('data-app'),base=s.getAttribute('data-base'),mode=s.getAttribute('data-mode')||'preview';
async function call(m,c,d){var r=await fetch(base+'/api/public/'+app+'/'+c+'?m='+mode,{method:m,headers:{'Content-Type':'text/plain'},body:d?JSON.stringify(d):undefined});var j=await r.json();if(!r.ok)throw new Error(j.error||'Error');return j}
window.contala={save:function(c,d){return call('POST',c,d)},list:function(c){return call('GET',c)}};
})();`);
});

/* ---------- Apps publicadas ---------- */
r.get('/app/:slug', wrap(async (req, res) => {
  const p = await one('SELECT public_id,published_html FROM projects WHERE slug=?', [req.params.slug]);
  if (!p || !p.published_html) return res.status(404).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Esta app no existe o no está publicada</h1><p><a href="${BASE}/">Creá la tuya en Contala</a></p>`);
  // Sandbox: la app corre aislada y no puede leer la sesión de Contala.
  res.set('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
  res.type('html').send(withSdk(p.published_html, req, p.public_id, 'live'));
}));

/* ---------- Plataforma ---------- */
// Módulo Sistema de vacaciones (portal por empresa en /v/<empresa>)
r.use(vac({ origin, BASE }));
const vacHtml = fs.readFileSync(path.join(__dirname, 'public', 'vac.html'), 'utf8').replace(/__BASE__/g, BASE);
r.get('/v/:slug', (req, res) => res.type('html').send(vacHtml.replace(/__SLUG__/g, String(req.params.slug).replace(/[^a-z0-9-]/g, ''))));

// Módulo Gestión de instituto (portal por instituto en /i/<instituto>)
r.use(inst({ origin, BASE }));
const instHtml = fs.readFileSync(path.join(__dirname, 'public', 'inst.html'), 'utf8').replace(/__BASE__/g, BASE);
r.get('/i/:slug', (req, res) => res.type('html').send(instHtml.replace(/__SLUG__/g, String(req.params.slug).replace(/[^a-z0-9-]/g, ''))));

// Módulo CRM de ventas / SDR (portal por equipo en /s/<equipo>)
r.use(sdr({ origin, BASE }));
const sdrHtml = fs.readFileSync(path.join(__dirname, 'public', 'sdr.html'), 'utf8').replace(/__BASE__/g, BASE);
r.get('/s/:slug', (req, res) => res.type('html').send(sdrHtml.replace(/__SLUG__/g, String(req.params.slug).replace(/[^a-z0-9-]/g, ''))));

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/__BASE__/g, BASE);
r.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));
r.get(['/', '/apps', '/apps/*', '/negocio', '/expertos'], (req, res) => res.type('html').send(indexHtml));
app.use(BASE || '/', r);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Algo salió mal. Probá de nuevo.' });
});

const port = process.env.PORT || 3000;
migrate()
  .then(() => vac.migrate())
  .then(() => inst.migrate())
  .then(() => sdr.migrate())
  .then(() => app.listen(port, () => console.log(`Contala en el puerto ${port}${BASE ? ' · ruta ' + BASE : ''} · IA: ${ai.provider()}`)))
  .catch(e => { console.error('No se pudo conectar a MySQL:', e.message); process.exit(1); });
