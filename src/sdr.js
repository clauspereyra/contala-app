// Módulo "CRM de ventas / SDR" (nivel 3): leads, embudo por etapas, asignación a cada SDR, actividades y
// seguimientos, mensajes escritos con IA, importación de Excel/CSV, formulario público de captura y resultados.
// Portal por equipo en /s/<equipo>.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { q, one } = require('./db');
const mail = require('./mail');
const ai = require('./ai');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rid = n => crypto.randomBytes(n).toString('hex').slice(0, n);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const todayAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fdate = s => new Date(String(s).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const digits = s => String(s || '').replace(/\D/g, '');

const STAGES = [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['interesado', 'Interesado'], ['reunion', 'Reunión'], ['ganado', 'Ganado'], ['perdido', 'Perdido']];
const STAGE_KEYS = STAGES.map(s => s[0]), STAGE_TXT = Object.fromEntries(STAGES);
const CLOSED = ['ganado', 'perdido'];
const KINDS = ['llamada', 'whatsapp', 'mail', 'reunion', 'nota'];
const KIND_TXT = { llamada: 'Llamada', whatsapp: 'WhatsApp', mail: 'Mail', reunion: 'Reunión', nota: 'Nota', etapa: 'Cambio de etapa', alta: 'Alta' };
const ROLE_TXT = { lider: 'Líder', sdr: 'SDR' };
const DEFAULT_CONFIG = {
  product: '', followDays: 3, formOn: true, notifyNew: true,
  sources: ['Formulario', 'Importación', 'Referido', 'Evento', 'Llamada entrante', 'Redes', 'Otro'],
  lostReasons: ['Sin presupuesto', 'No es el momento', 'Eligió a otro', 'No responde', 'No califica'],
};
const FIELDS = ['name', 'company', 'position', 'email', 'phone', 'website', 'source', 'tags', 'notes', 'value'];

async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS sdr_orgs (id INT AUTO_INCREMENT PRIMARY KEY, owner_user_id INT NOT NULL, slug VARCHAR(60) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, config TEXT NOT NULL,
    form_key CHAR(16) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS sdr_people (id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, name VARCHAR(160) NOT NULL, email VARCHAR(190) NOT NULL, role VARCHAR(10) NOT NULL DEFAULT 'sdr',
    pass_hash VARCHAR(100) NULL, invite_token CHAR(32) NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY (org_id,email), INDEX(org_id)) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS sdr_leads (id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, name VARCHAR(160) NOT NULL, company VARCHAR(160) NOT NULL DEFAULT '', position VARCHAR(120) NOT NULL DEFAULT '',
    email VARCHAR(190) NOT NULL DEFAULT '', phone VARCHAR(40) NOT NULL DEFAULT '', phone_key VARCHAR(8) NOT NULL DEFAULT '', website VARCHAR(255) NOT NULL DEFAULT '', source VARCHAR(60) NOT NULL DEFAULT 'Otro', tags VARCHAR(255) NOT NULL DEFAULT '',
    notes TEXT NULL, value DECIMAL(14,2) NOT NULL DEFAULT 0, stage VARCHAR(20) NOT NULL DEFAULT 'nuevo', owner_id INT NULL, next_at DATE NULL, next_note VARCHAR(255) NOT NULL DEFAULT '',
    lost_reason VARCHAR(120) NOT NULL DEFAULT '', consent VARCHAR(60) NOT NULL DEFAULT '', stage_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX(org_id, stage), INDEX(owner_id), INDEX(org_id, email), INDEX(org_id, phone_key)) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS sdr_activities (id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, lead_id INT NOT NULL, person_id INT NULL, kind VARCHAR(20) NOT NULL, stage VARCHAR(20) NULL,
    note TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(lead_id), INDEX(org_id, created_at)) CHARACTER SET utf8mb4`);
}

// Elige el SDR con menos leads abiertos (reparto parejo).
async function nextSdr(orgId) {
  const r = await one(`SELECT p.id FROM sdr_people p LEFT JOIN sdr_leads l ON l.owner_id=p.id AND l.stage NOT IN ('ganado','perdido')
    WHERE p.org_id=? AND p.active=1 AND p.role='sdr' GROUP BY p.id ORDER BY COUNT(l.id), p.id LIMIT 1`, [orgId]);
  return r ? r.id : null;
}
function cleanLead(b, cfg, base = {}) {
  const o = { ...base };
  for (const k of FIELDS) if (b[k] !== undefined) o[k] = k === 'value' ? Math.max(0, Number(String(b[k]).replace(/[^\d.,]/g, '').replace(',', '.')) || 0) : String(b[k] ?? '').trim();
  if (o.name !== undefined) o.name = o.name.slice(0, 160);
  for (const [k, n] of [['company', 160], ['position', 120], ['email', 190], ['phone', 40], ['website', 255], ['source', 60], ['tags', 255]]) if (o[k] !== undefined) o[k] = o[k].slice(0, n);
  if (o.email) o.email = o.email.toLowerCase();
  if (o.email && !EMAIL.test(o.email)) throw Object.assign(new Error('El mail no parece válido: ' + o.email), { status: 400 });
  if (o.notes !== undefined) o.notes = o.notes.slice(0, 4000);
  if (o.phone !== undefined) o.phone_key = digits(o.phone).slice(-8);
  return o;
}
async function findDup(orgId, email, phone, exceptId = 0) {
  const ph = digits(phone).slice(-8);
  if (email) { const d = await one('SELECT id,name FROM sdr_leads WHERE org_id=? AND email=? AND id<>?', [orgId, email, exceptId]); if (d) return d; }
  if (ph.length >= 8) { const d = await one('SELECT id,name FROM sdr_leads WHERE org_id=? AND id<>? AND phone_key=?', [orgId, exceptId, ph]); if (d) return d; }
  return null;
}

function router({ origin, BASE }) {
  const r = express.Router(), json = express.json({ limit: '3mb' });
  const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
  const portal = (req, o) => `${origin(req)}/s/${o.slug}`;
  async function loadOrg(slug) { const o = await one('SELECT * FROM sdr_orgs WHERE slug=?', [slug]); if (o) o.config = { ...DEFAULT_CONFIG, ...JSON.parse(o.config || '{}') }; return o; }
  const org = wrap(async (req, res, next) => {
    const o = await loadOrg(req.params.slug); if (!o) return res.status(404).json({ error: 'No encontramos ese equipo.' });
    req.org = o; const sid = req.session.sdr?.[o.id];
    req.me = sid ? await one('SELECT * FROM sdr_people WHERE id=? AND org_id=? AND active=1', [sid, o.id]) : null; next();
  });
  const signed = (req, res, next) => (req.me ? next() : res.status(401).json({ error: 'Ingresá con tu mail y contraseña.' }));
  const lider = (req, res, next) => (req.me?.role === 'lider' ? next() : res.status(403).json({ error: 'Esto lo maneja el líder del equipo.' }));
  const login = (req, o, pid) => { req.session.sdr = { ...(req.session.sdr || {}), [o.id]: pid }; };
  const box = (req, o, title, body) => `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:22px;border:1px solid #dde2e8"><h2 style="margin:0 0 10px">${esc(title)}</h2>${body}<p style="margin:18px 0 0"><a href="${portal(req, o)}" style="background:#2F5BD3;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir ${esc(o.name)}</a></p></div></body></html>`;
  // Un SDR ve solo sus leads; el líder ve todos.
  const scope = (me, alias = 'l') => (me.role === 'lider' ? ['1=1', []] : [`${alias}.owner_id=?`, [me.id]]);
  async function getLead(req, id) {
    const l = await one('SELECT * FROM sdr_leads WHERE id=? AND org_id=?', [id, req.org.id]);
    if (!l || (req.me.role !== 'lider' && l.owner_id !== req.me.id)) return null; return l;
  }
  const act = (o, leadId, pid, kind, note, stage = null) => q('INSERT INTO sdr_activities (org_id,lead_id,person_id,kind,stage,note) VALUES (?,?,?,?,?,?)', [o.id, leadId, pid, kind, stage, note || null]);
  async function invitePerson(req, o, { name, email, role }) {
    email = String(email || '').toLowerCase().trim();
    if (!EMAIL.test(email)) throw Object.assign(new Error('Mail inválido.'), { status: 400 });
    const ex = await one('SELECT * FROM sdr_people WHERE org_id=? AND email=?', [o.id, email]);
    if (ex) { await q('UPDATE sdr_people SET active=1 WHERE id=?', [ex.id]); return { person: ex, link: null }; }
    const token = rid(32);
    const ins = await q('INSERT INTO sdr_people (org_id,name,email,role,invite_token) VALUES (?,?,?,?,?)', [o.id, String(name || email).slice(0, 160), email, role === 'lider' ? 'lider' : 'sdr', token]);
    const link = `${portal(req, o)}?invitacion=${token}`;
    mail.send({ to: email, fromName: o.name, subject: `Tu acceso al CRM de ${o.name}`, html: box(req, o, `Hola ${name || ''}`, `<p>Te sumaron al equipo comercial de ${esc(o.name)}. Ahí vas a ver tus leads, tus seguimientos del día y tus resultados. Elegí tu contraseña con este link:</p><p><a href="${link}">${link}</a></p>`) }).catch(() => {});
    return { person: { id: ins.insertId }, link };
  }

  /* ----- Dueño (usuario de Contala) ----- */
  const owner = (req, res, next) => (req.session.uid ? next() : res.status(401).json({ error: 'Tenés que ingresar a Contala.' }));
  r.get('/api/sdr/orgs', owner, wrap(async (req, res) => res.json(await q("SELECT id,slug,name,(SELECT COUNT(*) FROM sdr_leads l WHERE l.org_id=o.id AND l.stage NOT IN ('ganado','perdido')) leads FROM sdr_orgs o WHERE owner_user_id=? ORDER BY id DESC", [req.session.uid]))));
  r.post('/api/sdr/orgs', owner, express.json(), wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 160);
    const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    if (!slug) return res.status(400).json({ error: 'Escribí el nombre de la empresa o del equipo.' });
    if (await one('SELECT id FROM sdr_orgs WHERE slug=?', [slug])) return res.status(400).json({ error: 'Ese nombre ya está en uso. Probá otro.' });
    const u = await one('SELECT name,email FROM users WHERE id=?', [req.session.uid]);
    const o = await q('INSERT INTO sdr_orgs (owner_user_id,slug,name,config,form_key) VALUES (?,?,?,?,?)', [req.session.uid, slug, name, JSON.stringify(DEFAULT_CONFIG), rid(16)]);
    await q("INSERT INTO sdr_people (org_id,name,email,role) VALUES (?,?,?,'lider')", [o.insertId, u.name, u.email]);
    res.json({ ok: true, slug });
  }));
  r.get('/s/:slug/entrar', wrap(async (req, res) => {
    const o = await loadOrg(req.params.slug);
    if (!o || o.owner_user_id !== req.session.uid) return res.redirect(`${BASE}/s/${req.params.slug}`);
    const u = await one('SELECT name,email FROM users WHERE id=?', [req.session.uid]);
    let p = await one('SELECT id FROM sdr_people WHERE org_id=? AND email=?', [o.id, u.email]);
    if (!p) { const x = await q("INSERT INTO sdr_people (org_id,name,email,role) VALUES (?,?,?,'lider')", [o.id, u.name, u.email]); p = { id: x.insertId }; }
    await q("UPDATE sdr_people SET active=1, role='lider' WHERE id=?", [p.id]);
    login(req, o, p.id); res.redirect(`${BASE}/s/${o.slug}`);
  }));

  /* ----- Sesión ----- */
  r.get('/api/s/:slug/me', org, wrap(async (req, res) => {
    const team = req.me ? await q('SELECT id,name,role FROM sdr_people WHERE org_id=? AND active=1 ORDER BY name', [req.org.id]) : [];
    const c = req.org.config;
    res.json({ org: { name: req.org.name, isOwner: req.org.owner_user_id === req.session.uid, config: req.me ? c : undefined, formKey: req.me?.role === 'lider' ? req.org.form_key : undefined }, stages: STAGES, kinds: KIND_TXT,
      me: req.me ? { id: req.me.id, name: req.me.name, role: req.me.role } : null, team, today: todayAR() });
  }));
  r.post('/api/s/:slug/login', org, express.json(), wrap(async (req, res) => {
    const p = await one('SELECT * FROM sdr_people WHERE org_id=? AND email=? AND active=1', [req.org.id, String(req.body?.email || '').toLowerCase().trim()]);
    if (!p || !p.pass_hash || !(await bcrypt.compare(String(req.body?.password || ''), p.pass_hash))) return res.status(400).json({ error: 'Mail o contraseña incorrectos. Si es tu primera vez, usá el link de invitación.' });
    login(req, req.org, p.id); res.json({ ok: true });
  }));
  r.post('/api/s/:slug/logout', org, (req, res) => { const s = { ...(req.session.sdr || {}) }; delete s[req.org.id]; req.session.sdr = s; res.json({ ok: true }); });
  r.get('/api/s/:slug/invite/:token', org, wrap(async (req, res) => { const p = await one('SELECT name,email FROM sdr_people WHERE org_id=? AND invite_token=?', [req.org.id, req.params.token]); p ? res.json(p) : res.status(404).json({ error: 'El link no es válido o ya se usó.' }); }));
  r.post('/api/s/:slug/invite/:token', org, express.json(), wrap(async (req, res) => {
    const pw = String(req.body?.password || ''); if (pw.length < 8) return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
    const p = await one('SELECT id FROM sdr_people WHERE org_id=? AND invite_token=?', [req.org.id, req.params.token]);
    if (!p) return res.status(404).json({ error: 'El link no es válido o ya se usó.' });
    await q('UPDATE sdr_people SET pass_hash=?, invite_token=NULL WHERE id=?', [await bcrypt.hash(pw, 10), p.id]); login(req, req.org, p.id); res.json({ ok: true });
  }));

  /* ----- Leads ----- */
  const LIST = `SELECT l.id,l.name,l.company,l.position,l.email,l.phone,l.source,l.tags,l.value,l.stage,l.owner_id,l.next_at,l.next_note,l.created_at,l.stage_at,
    p.name owner_name,(SELECT MAX(a.created_at) FROM sdr_activities a WHERE a.lead_id=l.id AND a.kind IN ('llamada','whatsapp','mail','reunion','nota')) last_at
    FROM sdr_leads l LEFT JOIN sdr_people p ON p.id=l.owner_id`;
  r.get('/api/s/:slug/leads', org, signed, wrap(async (req, res) => {
    const [w, a] = scope(req.me); const where = [`l.org_id=?`, w], args = [req.org.id, ...a];
    if (STAGE_KEYS.includes(req.query.stage)) { where.push('l.stage=?'); args.push(req.query.stage); }
    else if (req.query.stage === 'abiertos') where.push("l.stage NOT IN ('ganado','perdido')");
    if (req.query.owner === 'none') where.push('l.owner_id IS NULL');
    else if (req.query.owner) { where.push('l.owner_id=?'); args.push(Number(req.query.owner)); }
    if (req.query.q) { const s = `%${String(req.query.q).slice(0, 80)}%`; where.push('(l.name LIKE ? OR l.company LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.tags LIKE ?)'); args.push(s, s, s, s, s); }
    res.json(await q(`${LIST} WHERE ${where.join(' AND ')} ORDER BY l.updated_at DESC LIMIT 1000`, args));
  }));
  // "Hoy": seguimientos vencidos o de hoy + leads nuevos sin contactar.
  r.get('/api/s/:slug/today', org, signed, wrap(async (req, res) => {
    const [w, a] = scope(req.me), t = todayAR();
    const due = await q(`${LIST} WHERE l.org_id=? AND ${w} AND l.stage NOT IN ('ganado','perdido') AND l.next_at IS NOT NULL AND l.next_at<=? ORDER BY l.next_at, l.id`, [req.org.id, ...a, t]);
    const fresh = await q(`${LIST} WHERE l.org_id=? AND ${w} AND l.stage='nuevo' AND l.next_at IS NULL AND NOT EXISTS (SELECT 1 FROM sdr_activities x WHERE x.lead_id=l.id AND x.kind IN ('llamada','whatsapp','mail','reunion')) ORDER BY l.created_at LIMIT 100`, [req.org.id, ...a]);
    const unassigned = req.me.role === 'lider' ? (await one("SELECT COUNT(*) c FROM sdr_leads WHERE org_id=? AND owner_id IS NULL AND stage NOT IN ('ganado','perdido')", [req.org.id])).c : 0;
    const upcoming = await q(`${LIST} WHERE l.org_id=? AND ${w} AND l.stage NOT IN ('ganado','perdido') AND l.next_at>? AND l.next_at<=? ORDER BY l.next_at LIMIT 30`, [req.org.id, ...a, t, addDays(t, 7)]);
    res.json({ today: t, due, fresh, upcoming, unassigned });
  }));
  r.post('/api/s/:slug/leads', org, signed, json, wrap(async (req, res) => {
    const b = req.body || {}, o = cleanLead(b, req.org.config);
    if (!o.name) return res.status(400).json({ error: 'Escribí al menos el nombre.' });
    const dup = await findDup(req.org.id, o.email, o.phone);
    if (dup && !b.force) return res.status(409).json({ error: `Ya existe un lead con ese mail o teléfono: ${dup.name}.`, dup });
    let ownerId = req.me.role === 'lider' ? (b.owner_id === 'auto' ? await nextSdr(req.org.id) : (Number(b.owner_id) || null)) : req.me.id;
    if (ownerId && !(await one('SELECT id FROM sdr_people WHERE id=? AND org_id=?', [ownerId, req.org.id]))) ownerId = null;
    const ins = await q(`INSERT INTO sdr_leads (org_id,name,company,position,email,phone,phone_key,website,source,tags,notes,value,owner_id,consent,stage_at,next_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
      [req.org.id, o.name, o.company || '', o.position || '', o.email || '', o.phone || '', o.phone_key || '', o.website || '', o.source || 'Otro', o.tags || '', o.notes || null, o.value || 0, ownerId, 'Alta manual', ISO.test(b.next_at) ? b.next_at : null]);
    await act(req.org, ins.insertId, req.me.id, 'alta', `Cargado por ${req.me.name}`);
    res.json({ ok: true, id: ins.insertId });
  }));
  r.get('/api/s/:slug/leads/:id', org, signed, wrap(async (req, res) => {
    const l = await getLead(req, Number(req.params.id)); if (!l) return res.status(404).json({ error: 'No encontramos ese lead.' });
    const acts = await q('SELECT a.id,a.kind,a.stage,a.note,a.created_at,p.name who FROM sdr_activities a LEFT JOIN sdr_people p ON p.id=a.person_id WHERE a.lead_id=? ORDER BY a.id DESC LIMIT 200', [l.id]);
    res.json({ lead: l, activities: acts });
  }));
  r.post('/api/s/:slug/leads/:id', org, signed, json, wrap(async (req, res) => {
    const l = await getLead(req, Number(req.params.id)); if (!l) return res.status(404).json({ error: 'No encontramos ese lead.' });
    const b = req.body || {}, o = cleanLead(b, req.org.config), set = {}, notes = [];
    for (const k of FIELDS) if (o[k] !== undefined && (k === 'value' ? Number(o[k]) !== Number(l[k]) : String(o[k]) !== String(l[k] ?? ''))) set[k] = o[k];
    if (set.phone !== undefined) set.phone_key = o.phone_key;
    if (set.name === '') return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
    if ((set.email || set.phone) && !b.force) { const d = await findDup(req.org.id, set.email, set.phone, l.id); if (d) return res.status(409).json({ error: `Ya existe otro lead con ese mail o teléfono: ${d.name}.`, dup: d }); }
    if (b.next_at !== undefined) { set.next_at = ISO.test(b.next_at) ? b.next_at : null; set.next_note = String(b.next_note || '').slice(0, 255); }
    if (b.owner_id !== undefined && req.me.role === 'lider') {
      const nid = Number(b.owner_id) || null;
      if (nid !== l.owner_id) {
        const p = nid ? await one('SELECT id,name,email FROM sdr_people WHERE id=? AND org_id=? AND active=1', [nid, req.org.id]) : null;
        set.owner_id = p ? p.id : null; notes.push(['etapa', null, p ? `Asignado a ${p.name}` : 'Sin asignar']);
        if (p && p.id !== req.me.id) mail.send({ to: p.email, fromName: req.org.name, subject: `Te asignaron un lead: ${l.name}`, html: box(req, req.org, 'Nuevo lead para vos', `<p><b>${esc(l.name)}</b>${l.company ? ' · ' + esc(l.company) : ''}</p><p>Te lo asignó ${esc(req.me.name)}.</p>`) }).catch(() => {});
      }
    }
    if (b.stage !== undefined && b.stage !== l.stage) {
      if (!STAGE_KEYS.includes(b.stage)) return res.status(400).json({ error: 'Etapa inválida.' });
      if (b.stage === 'perdido' && !String(b.lost_reason || '').trim()) return res.status(400).json({ error: 'Contanos por qué se perdió (sirve para mejorar).' });
      set.stage = b.stage; set.stage_at = new Date(); set.lost_reason = b.stage === 'perdido' ? String(b.lost_reason).slice(0, 120) : '';
      if (CLOSED.includes(b.stage)) { set.next_at = null; set.next_note = ''; }
      notes.push(['etapa', b.stage, `${STAGE_TXT[l.stage]} → ${STAGE_TXT[b.stage]}${b.stage === 'perdido' ? ' (' + set.lost_reason + ')' : ''}`]);
    }
    if (Object.keys(set).length) await q(`UPDATE sdr_leads SET ${Object.keys(set).map(k => k + '=?').join(',')} WHERE id=?`, [...Object.values(set), l.id]);
    for (const [k, st, n] of notes) await act(req.org, l.id, req.me.id, k, n, st);
    res.json({ ok: true });
  }));
  r.delete('/api/s/:slug/leads/:id', org, lider, wrap(async (req, res) => {
    await q('DELETE FROM sdr_activities WHERE lead_id=? AND org_id=?', [Number(req.params.id), req.org.id]);
    await q('DELETE FROM sdr_leads WHERE id=? AND org_id=?', [Number(req.params.id), req.org.id]); res.json({ ok: true });
  }));
  // Registrar actividad (llamada, WhatsApp, mail, reunión, nota) y el próximo seguimiento.
  r.post('/api/s/:slug/leads/:id/activity', org, signed, json, wrap(async (req, res) => {
    const l = await getLead(req, Number(req.params.id)); if (!l) return res.status(404).json({ error: 'No encontramos ese lead.' });
    const b = req.body || {}, kind = KINDS.includes(b.kind) ? b.kind : 'nota', note = String(b.note || '').trim().slice(0, 4000);
    if (kind === 'nota' && !note) return res.status(400).json({ error: 'Escribí la nota.' });
    await act(req.org, l.id, req.me.id, kind, note);
    const set = {};
    if (b.next_at !== undefined) { set.next_at = ISO.test(b.next_at) ? b.next_at : null; set.next_note = String(b.next_note || '').slice(0, 255); }
    else if (kind !== 'nota' && !CLOSED.includes(l.stage)) { set.next_at = addDays(todayAR(), Number(req.org.config.followDays) || 3); set.next_note = 'Seguimiento'; }
    let stage = null;
    if (l.stage === 'nuevo' && kind !== 'nota') stage = 'contactado';
    if (kind === 'reunion' && ['nuevo', 'contactado', 'interesado'].includes(l.stage)) stage = 'reunion';
    if (stage) { set.stage = stage; set.stage_at = new Date(); }
    if (Object.keys(set).length) await q(`UPDATE sdr_leads SET ${Object.keys(set).map(k => k + '=?').join(',')} WHERE id=?`, [...Object.values(set), l.id]);
    if (stage) await act(req.org, l.id, req.me.id, 'etapa', `${STAGE_TXT[l.stage]} → ${STAGE_TXT[stage]}`, stage);
    res.json({ ok: true, stage, next_at: set.next_at });
  }));
  // Mensaje escrito por la IA (WhatsApp o mail), para revisar antes de mandarlo.
  r.post('/api/s/:slug/leads/:id/draft', org, signed, express.json(), wrap(async (req, res) => {
    const l = await getLead(req, Number(req.params.id)); if (!l) return res.status(404).json({ error: 'No encontramos ese lead.' });
    const day = todayAR(), uid = req.org.owner_user_id, limit = Number(process.env.DAILY_AI_LIMIT || 60) * 2;
    const use = await one('SELECT calls FROM ai_usage WHERE user_id=? AND day=?', [uid, day]);
    if (use && use.calls >= limit) return res.status(429).json({ error: 'El equipo llegó al límite diario de mensajes con IA. Mañana se renueva.' });
    const acts = await q("SELECT kind,note,created_at FROM sdr_activities WHERE lead_id=? AND kind<>'alta' ORDER BY id DESC LIMIT 8", [l.id]);
    let out;
    try { out = await ai.draft({ org: req.org.name, product: req.org.config.product, lead: l, activities: acts, channel: req.body?.channel === 'mail' ? 'mail' : 'whatsapp', goal: String(req.body?.goal || 'primer contacto').slice(0, 60), sender: req.me.name, extra: String(req.body?.extra || '').slice(0, 400) }); }
    catch (e) { console.error(e); return res.status(502).json({ error: 'No pude escribir el mensaje ahora. Probá en un momento.' }); }
    await q('INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,1) ON DUPLICATE KEY UPDATE calls=calls+1', [uid, day]);
    res.json(out);
  }));
  // Reasignar varios leads a la vez.
  r.post('/api/s/:slug/assign', org, lider, express.json(), wrap(async (req, res) => {
    const ids = (req.body?.ids || []).map(Number).filter(Boolean).slice(0, 2000); if (!ids.length) return res.status(400).json({ error: 'Elegí al menos un lead.' });
    const mode = req.body?.owner_id; let n = 0;
    for (const id of ids) {
      const l = await one('SELECT id,owner_id FROM sdr_leads WHERE id=? AND org_id=?', [id, req.org.id]); if (!l) continue;
      const nid = mode === 'auto' ? await nextSdr(req.org.id) : (Number(mode) || null);
      const p = nid ? await one('SELECT id,name FROM sdr_people WHERE id=? AND org_id=? AND active=1', [nid, req.org.id]) : null;
      await q('UPDATE sdr_leads SET owner_id=? WHERE id=?', [p ? p.id : null, id]); await act(req.org, id, req.me.id, 'etapa', p ? `Asignado a ${p.name}` : 'Sin asignar'); n++;
    }
    res.json({ ok: true, n });
  }));
  // Importación (las columnas se eligen en la pantalla; acá llegan filas ya mapeadas).
  r.post('/api/s/:slug/import', org, signed, json, wrap(async (req, res) => {
    const b = req.body || {}; if (!b.consent) return res.status(400).json({ error: 'Confirmá el origen de los contactos para poder importarlos.' });
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : []; if (!rows.length) return res.status(400).json({ error: 'No hay filas para importar.' });
    let added = 0, dup = 0, bad = 0; const seen = new Set();
    const fixed = req.me.role === 'lider' ? (b.assign === 'auto' ? 'auto' : (Number(b.assign) || null)) : req.me.id;
    for (const row of rows) {
      let o; try { o = cleanLead(row || {}, req.org.config); } catch { bad++; continue; }
      if (!o.name) o.name = [o.company, o.email, o.phone].find(Boolean) || '';
      if (!o.name) { bad++; continue; }
      const key = o.email || digits(o.phone).slice(-8);
      if (key && seen.has(key)) { dup++; continue; } if (key) seen.add(key);
      if (await findDup(req.org.id, o.email, o.phone)) { dup++; continue; }
      const ownerId = fixed === 'auto' ? await nextSdr(req.org.id) : fixed;
      const ins = await q(`INSERT INTO sdr_leads (org_id,name,company,position,email,phone,phone_key,website,source,tags,notes,value,owner_id,consent,stage_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [req.org.id, o.name, o.company || '', o.position || '', o.email || '', o.phone || '', o.phone_key || '', o.website || '', o.source || 'Importación', o.tags || String(b.tag || '').slice(0, 255), o.notes || null, o.value || 0, ownerId, 'Importación declarada']);
      await act(req.org, ins.insertId, req.me.id, 'alta', `Importado por ${req.me.name}`); added++;
    }
    res.json({ ok: true, added, dup, bad });
  }));
  r.get('/api/s/:slug/export.csv', org, lider, wrap(async (req, res) => {
    const rows = await q(`${LIST} WHERE l.org_id=? ORDER BY l.id`, [req.org.id]);
    const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Nombre', 'Empresa', 'Cargo', 'Mail', 'Teléfono', 'Origen', 'Etiquetas', 'Valor', 'Etapa', 'Responsable', 'Próximo seguimiento', 'Último contacto', 'Alta'].map(c).join(';')]
      .concat(rows.map(l => [l.name, l.company, l.position, l.email, l.phone, l.source, l.tags, l.value, STAGE_TXT[l.stage], l.owner_name || '', l.next_at || '', l.last_at ? new Date(l.last_at).toISOString().slice(0, 10) : '', new Date(l.created_at).toISOString().slice(0, 10)].map(c).join(';')));
    res.set('Content-Disposition', `attachment; filename="leads-${req.org.slug}.csv"`).type('text/csv; charset=utf-8').send('﻿' + lines.join('\r\n'));
  }));

  /* ----- Resultados ----- */
  r.get('/api/s/:slug/stats', org, signed, wrap(async (req, res) => {
    const from = ISO.test(req.query.from) ? req.query.from : '2000-01-01', [w, a] = scope(req.me), O = req.org.id;
    const n = async (sql, args) => Number((await one(sql, args)).c || 0);
    const funnel = Object.fromEntries(STAGE_KEYS.map(k => [k, 0]));
    for (const x of await q(`SELECT stage, COUNT(*) c FROM sdr_leads l WHERE org_id=? AND ${w} GROUP BY stage`, [O, ...a])) funnel[x.stage] = Number(x.c);
    const created = await n(`SELECT COUNT(*) c FROM sdr_leads l WHERE org_id=? AND ${w} AND created_at>=?`, [O, ...a, from]);
    const moved = async st => n(`SELECT COUNT(DISTINCT x.lead_id) c FROM sdr_activities x JOIN sdr_leads l ON l.id=x.lead_id WHERE x.org_id=? AND ${w} AND x.kind='etapa' AND x.stage=? AND x.created_at>=?`, [O, ...a, st, from]);
    const contacted = await n(`SELECT COUNT(DISTINCT x.lead_id) c FROM sdr_activities x JOIN sdr_leads l ON l.id=x.lead_id WHERE x.org_id=? AND ${w} AND x.kind IN ('llamada','whatsapp','mail','reunion') AND x.created_at>=?`, [O, ...a, from]);
    const meetings = await moved('reunion'), won = await moved('ganado'), lost = await moved('perdido');
    const value = Number((await one(`SELECT COALESCE(SUM(value),0) c FROM sdr_leads l WHERE org_id=? AND ${w} AND stage='ganado' AND stage_at>=?`, [O, ...a, from])).c);
    const actsN = await n(`SELECT COUNT(*) c FROM sdr_activities x JOIN sdr_leads l ON l.id=x.lead_id WHERE x.org_id=? AND ${w} AND x.kind IN ('llamada','whatsapp','mail','reunion') AND x.created_at>=?`, [O, ...a, from]);
    const sources = await q(`SELECT source k, COUNT(*) c, SUM(stage='ganado') won FROM sdr_leads l WHERE org_id=? AND ${w} AND created_at>=? GROUP BY source ORDER BY c DESC`, [O, ...a, from]);
    const reasons = await q(`SELECT lost_reason k, COUNT(*) c FROM sdr_leads l WHERE org_id=? AND ${w} AND stage='perdido' AND stage_at>=? GROUP BY lost_reason ORDER BY c DESC`, [O, ...a, from]);
    // Ranking de todo el equipo (motiva y se ve entre todos).
    const ranking = await q(`SELECT p.id,p.name,p.role,
      (SELECT COUNT(*) FROM sdr_leads l WHERE l.owner_id=p.id AND l.stage NOT IN ('ganado','perdido')) open_leads,
      (SELECT COUNT(*) FROM sdr_activities x WHERE x.person_id=p.id AND x.kind IN ('llamada','whatsapp','mail','reunion') AND x.created_at>=?) acts,
      (SELECT COUNT(DISTINCT x.lead_id) FROM sdr_activities x WHERE x.person_id=p.id AND x.kind='etapa' AND x.stage='reunion' AND x.created_at>=?) meetings,
      (SELECT COUNT(DISTINCT x.lead_id) FROM sdr_activities x WHERE x.person_id=p.id AND x.kind='etapa' AND x.stage='ganado' AND x.created_at>=?) won,
      (SELECT COUNT(*) FROM sdr_leads l WHERE l.owner_id=p.id AND l.stage NOT IN ('ganado','perdido') AND l.next_at<?) late
      FROM sdr_people p WHERE p.org_id=? AND p.active=1`, [from, from, from, todayAR(), O]);
    ranking.forEach(x => { for (const k of ['open_leads', 'acts', 'meetings', 'won', 'late']) x[k] = Number(x[k]); });
    ranking.sort((x, y) => y.won - x.won || y.meetings - x.meetings || y.acts - x.acts);
    res.json({ from, funnel, created, contacted, meetings, won, lost, value, acts: actsN, conversion: created ? Math.round(won / created * 1000) / 10 : 0, sources, reasons, ranking: ranking.filter(x => x.role === 'sdr' || x.open_leads || x.acts) });
  }));

  /* ----- Equipo y ajustes (líder) ----- */
  r.get('/api/s/:slug/team', org, lider, wrap(async (req, res) => res.json(await q(`SELECT p.id,p.name,p.email,p.role,p.active,p.pass_hash IS NOT NULL joined,
    (SELECT COUNT(*) FROM sdr_leads l WHERE l.owner_id=p.id AND l.stage NOT IN ('ganado','perdido')) open_leads FROM sdr_people p WHERE org_id=? ORDER BY p.active DESC, p.name`, [req.org.id]))));
  r.post('/api/s/:slug/team', org, lider, express.json(), wrap(async (req, res) => {
    const { link } = await invitePerson(req, req.org, req.body || {}); res.json({ ok: true, link });
  }));
  r.post('/api/s/:slug/team/:id', org, lider, express.json(), wrap(async (req, res) => {
    const p = await one('SELECT * FROM sdr_people WHERE id=? AND org_id=?', [Number(req.params.id), req.org.id]); if (!p) return res.status(404).json({ error: 'No encontramos a esa persona.' });
    if (p.id === req.me.id && (req.body?.active === false || req.body?.role === 'sdr')) return res.status(400).json({ error: 'No podés quitarte el rol de líder a vos mismo.' });
    if (req.body?.role) await q('UPDATE sdr_people SET role=? WHERE id=?', [req.body.role === 'lider' ? 'lider' : 'sdr', p.id]);
    if (req.body?.active !== undefined) {
      await q('UPDATE sdr_people SET active=? WHERE id=?', [req.body.active ? 1 : 0, p.id]);
      if (!req.body.active && req.body.reassign) { // reparte sus leads abiertos entre el resto
        for (const l of await q("SELECT id FROM sdr_leads WHERE owner_id=? AND stage NOT IN ('ganado','perdido')", [p.id])) {
          const nid = await nextSdr(req.org.id); await q('UPDATE sdr_leads SET owner_id=? WHERE id=?', [nid, l.id]);
        }
      }
    }
    if (req.body?.resend) { const token = rid(32); await q('UPDATE sdr_people SET invite_token=? WHERE id=?', [token, p.id]); return res.json({ ok: true, link: `${portal(req, req.org)}?invitacion=${token}` }); }
    res.json({ ok: true });
  }));
  r.post('/api/s/:slug/config', org, lider, express.json(), wrap(async (req, res) => {
    const b = req.body || {}, c = { ...req.org.config };
    if (b.product !== undefined) c.product = String(b.product).slice(0, 1500);
    if (b.followDays !== undefined) c.followDays = Math.min(30, Math.max(1, Number(b.followDays) || 3));
    if (b.formOn !== undefined) c.formOn = !!b.formOn;
    if (b.notifyNew !== undefined) c.notifyNew = !!b.notifyNew;
    const list = v => [...new Set(String(v).split(/\n|,/).map(s => s.trim()).filter(Boolean))].slice(0, 20).map(s => s.slice(0, 60));
    if (b.sources !== undefined) c.sources = list(b.sources).length ? list(b.sources) : DEFAULT_CONFIG.sources;
    if (b.lostReasons !== undefined) c.lostReasons = list(b.lostReasons).length ? list(b.lostReasons) : DEFAULT_CONFIG.lostReasons;
    await q('UPDATE sdr_orgs SET config=? WHERE id=?', [JSON.stringify(c), req.org.id]); res.json({ ok: true, config: c });
  }));

  /* ----- Formulario público de captura (con consentimiento) ----- */
  const hits = new Map();
  r.get('/s/:slug/form/:key', wrap(async (req, res) => {
    const o = await loadOrg(req.params.slug);
    if (!o || o.form_key !== req.params.key || !o.config.formOn) return res.status(404).type('html').send('<p style="font-family:sans-serif;padding:24px">Este formulario no está disponible.</p>');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors *").type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contacto · ${esc(o.name)}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F4F6F8;color:#111A22;padding:16px}form{max-width:460px;margin:auto;background:#fff;border:1px solid #DDE2E8;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:12px}
h1{font-size:1.3em;margin:0}label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:.9em}input,textarea{font:inherit;border:1.5px solid #DDE2E8;border-radius:10px;padding:10px}.ck{flex-direction:row;gap:8px;align-items:flex-start;font-weight:400;font-size:.85em;color:#56616E}
button{font:inherit;background:#2F5BD3;color:#fff;border:0;border-radius:10px;padding:12px;font-weight:700}.hp{position:absolute;left:-9999px}.msg{padding:10px;border-radius:10px}.ok{background:#E5F4EA;color:#1E7F45}.bad{background:#FDE7E5;color:#B42318}
@media (prefers-color-scheme:dark){body{background:#0E1318;color:#ECF0F3}form{background:#161C22;border-color:#28313A}input,textarea{background:#0E1318;color:#ECF0F3;border-color:#28313A}.ck{color:#9AA6B2}}</style></head><body>
<form id="f"><h1>Contactanos · ${esc(o.name)}</h1><label>Nombre y apellido<input name="name" required maxlength="160" autocomplete="name"></label><label>Empresa<input name="company" maxlength="160" autocomplete="organization"></label>
<label>Mail<input name="email" type="email" maxlength="190" autocomplete="email"></label><label>WhatsApp o teléfono<input name="phone" maxlength="40" autocomplete="tel" inputmode="tel"></label><label>¿En qué te podemos ayudar?<textarea name="message" rows="3" maxlength="1500"></textarea></label>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><label class="ck"><input type="checkbox" name="consent" required> <span>Acepto que ${esc(o.name)} me contacte por mail, teléfono o WhatsApp sobre mi consulta. Puedo pedir que borren mis datos cuando quiera.</span></label>
<div id="m" class="msg" hidden></div><button>Enviar</button></form>
<script>document.getElementById('f').onsubmit=async function(e){e.preventDefault();var d=Object.fromEntries(new FormData(this));d.consent=!!this.consent.checked;var m=document.getElementById('m');if(!d.email&&!d.phone){m.hidden=false;m.className='msg bad';m.textContent='Dejanos un mail o un teléfono para responderte.';return}
var r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});var j=await r.json().catch(function(){return{}});m.hidden=false;if(r.ok){this.reset();m.className='msg ok';m.textContent='¡Gracias! Te vamos a contactar a la brevedad.'}else{m.className='msg bad';m.textContent=j.error||'No se pudo enviar. Probá de nuevo.'}}</script></body></html>`);
  }));
  r.post('/s/:slug/form/:key', express.json({ limit: '20kb' }), wrap(async (req, res) => {
    const o = await loadOrg(req.params.slug);
    if (!o || o.form_key !== req.params.key || !o.config.formOn) return res.status(404).json({ error: 'Este formulario no está disponible.' });
    const b = req.body || {}; if (b.website) return res.json({ ok: true }); // trampa para robots
    const ip = req.ip || '', now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 600e3);
    if (h.length >= 5) return res.status(429).json({ error: 'Recibimos varios envíos seguidos. Probá en unos minutos.' }); h.push(now); hits.set(ip, h);
    if (!b.consent) return res.status(400).json({ error: 'Necesitamos tu permiso para contactarte.' });
    let l; try { l = cleanLead({ name: b.name, company: b.company, email: b.email, phone: b.phone }, o.config); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!l.name || (!l.email && !l.phone)) return res.status(400).json({ error: 'Completá tu nombre y un mail o teléfono.' });
    const msg = String(b.message || '').trim().slice(0, 1500);
    const dup = await findDup(o.id, l.email, l.phone);
    if (dup) { await act(o, dup.id, null, 'nota', `Volvió a escribir por el formulario${msg ? ': ' + msg : '.'}`); await q('UPDATE sdr_leads SET next_at=? WHERE id=? AND stage NOT IN (\'ganado\',\'perdido\')', [todayAR(), dup.id]); return res.json({ ok: true }); }
    const ownerId = await nextSdr(o.id);
    const ins = await q(`INSERT INTO sdr_leads (org_id,name,company,email,phone,phone_key,source,notes,owner_id,consent,stage_at,next_at) VALUES (?,?,?,?,?,?,'Formulario',?,?,?,NOW(),?)`, [o.id, l.name, l.company || '', l.email || '', l.phone || '', l.phone_key || '', msg || null, ownerId, 'Formulario con consentimiento ' + todayAR(), todayAR()]);
    await act(o, ins.insertId, null, 'alta', msg ? `Llegó por el formulario: ${msg}` : 'Llegó por el formulario.');
    if (o.config.notifyNew) {
      const to = await q("SELECT email FROM sdr_people WHERE org_id=? AND active=1 AND (role='lider' OR id=?)", [o.id, ownerId || 0]);
      for (const p of to) mail.send({ to: p.email, fromName: o.name, subject: `Nuevo lead: ${l.name}`, html: box(req, o, 'Llegó un lead nuevo', `<p><b>${esc(l.name)}</b>${l.company ? ' · ' + esc(l.company) : ''}<br>${esc(l.email || '')} ${esc(l.phone || '')}</p>${msg ? `<p style="background:#f4f6f8;padding:10px;border-radius:8px">${esc(msg)}</p>` : ''}<p>Contactalo hoy: los leads que se responden en la primera hora cierran mucho más.</p>`) }).catch(() => {});
    }
    res.json({ ok: true });
  }));
  return r;
}

// Resumen diario por mail: seguimientos de hoy y vencidos (lo dispara el Cron nocturno).
async function digest({ origin }) {
  const t = todayAR(); let sent = 0;
  for (const o of await q('SELECT id,slug,name FROM sdr_orgs')) {
    for (const p of await q('SELECT id,name,email,role FROM sdr_people WHERE org_id=? AND active=1 AND (pass_hash IS NOT NULL OR role=\'lider\')', [o.id])) {
      const due = await q("SELECT name,company,next_at,next_note FROM sdr_leads WHERE org_id=? AND owner_id=? AND stage NOT IN ('ganado','perdido') AND next_at<=? ORDER BY next_at LIMIT 30", [o.id, p.id, t]);
      const stale = p.role === 'lider' ? Number((await one("SELECT COUNT(*) c FROM sdr_leads l WHERE org_id=? AND stage='nuevo' AND created_at < NOW() - INTERVAL 2 DAY AND NOT EXISTS (SELECT 1 FROM sdr_activities x WHERE x.lead_id=l.id AND x.kind IN ('llamada','whatsapp','mail','reunion'))", [o.id])).c) : 0;
      const free = p.role === 'lider' ? Number((await one("SELECT COUNT(*) c FROM sdr_leads WHERE org_id=? AND owner_id IS NULL AND stage NOT IN ('ganado','perdido')", [o.id])).c) : 0;
      if (!due.length && !stale && !free) continue;
      const li = due.map(l => `<li><b>${esc(l.name)}</b>${l.company ? ' · ' + esc(l.company) : ''} — ${l.next_at < t ? '<span style="color:#B42318">vencido (' + fdate(l.next_at) + ')</span>' : 'hoy'}${l.next_note ? ' · ' + esc(l.next_note) : ''}</li>`).join('');
      const extra = (stale ? `<p>⚠ Hay <b>${stale}</b> ${stale === 1 ? 'lead nuevo' : 'leads nuevos'} sin contactar hace más de 2 días.</p>` : '') + (free ? `<p>Hay <b>${free}</b> ${free === 1 ? 'lead' : 'leads'} sin asignar.</p>` : '');
      await mail.send({ to: p.email, fromName: o.name, subject: due.length ? `Tus seguimientos de hoy (${due.length})` : 'Resumen del equipo comercial',
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:22px;border:1px solid #dde2e8"><h2 style="margin:0 0 10px">Buen día, ${esc(p.name.split(' ')[0])}</h2>${due.length ? `<p>Para hoy tenés:</p><ul>${li}</ul>` : ''}${extra}<p style="margin:18px 0 0"><a href="${origin}/s/${o.slug}" style="background:#2F5BD3;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir ${esc(o.name)}</a></p></div></body></html>` }).catch(() => {});
      sent++;
    }
  }
  return { sdrDigests: sent };
}

module.exports = router;
module.exports.migrate = migrate;
module.exports.digest = digest;
