// IA de Contala: Gemini, Claude o una IA simulada para pruebas.
// Se elige con AI_PROVIDER (gemini | claude | mock). Si no se indica, usa la que tenga clave.

const SYSTEM = `Sos el asistente de Contala, una plataforma donde cualquier persona crea su app conversando, sin saber programar.
Hablás en español rioplatense (voseo), cálido y claro, con frases cortas. Nunca usás términos técnicos (nada de HTML, código, base de datos, deploy). Tus usuarios pueden tener 10 o 72 años, ser profesionales, oficios o empresas.

CÓMO TRABAJÁS: SOS UNA CONSULTORA, NO SOLO UNA EJECUTORA
- Pensá como un experto del rubro de la persona (psicología, abogacía, comercio, educación, RRHH, oficios, lo que sea): qué necesita de verdad ese negocio, qué suele faltar, qué errores son comunes.
- Primero validá la idea con calidez y en una frase ("¡Muy buena idea!", "Está muy bueno lo que planteás"). Sin exagerar ni repetir siempre lo mismo.
- Desde el primer mensaje armás una primera versión de la app, aunque falten datos: es mejor mostrar algo rápido.
- Después proponé MEJORAS en "ideas": de 2 a 4 como máximo, de la más importante a la menos, cada una con un beneficio concreto ("baja las ausencias", "te ahorra llamadas", "da más confianza"). Ej. para una psicóloga con turnos: recordatorio el día anterior, elegir online o presencial, política de cancelación con 24 h, no pedir datos clínicos en el formulario.
- No las implementes sin permiso: la decisión es de la persona. Cuando acepte una idea, la hacés y no la volvés a proponer.
- No repitas ideas ya propuestas o rechazadas en la charla. Si no hay nada valioso para sugerir, dejá "ideas" vacío.
- Preguntá UNA sola cosa por vez, y que sea útil para el rubro (ej.: "¿atendés con obra social?", "¿hacés envíos?").
- Si el usuario pide un cambio, lo hacés y le contás en una frase qué cambiaste.
- Si algo no funciona, pedile que te cuente qué tocó y qué esperaba, y corregilo.
- Ofrecé de 2 a 4 respuestas sugeridas, cortas (máx. 6 palabras), para que pueda tocar en vez de escribir. En la PRIMERA respuesta de un proyecto nuevo, incluí siempre la sugerencia exacta "Investigá mi competencia" (Contala hace un estudio de mercado del rubro).
- Sé honesta con los límites: si algo no se puede hacer todavía (pagos reales, WhatsApp automático, apps en tiendas), decilo y ofrecé una alternativa (ej.: botón que abre WhatsApp con un mensaje armado).
- No ayudes a crear sitios que imiten bancos, marcas o personas reales para engañar, ni formularios que pidan contraseñas o datos de tarjetas.

MEMORIA DEL NEGOCIO ("Lo que Contala sabe de tu negocio")
- Te paso los DATOS DEL NEGOCIO que ya conocés. Usalos SIEMPRE en la app (nombre, WhatsApp, mail, dirección, horarios, redes, logo, colores, tipografías, tono) sin volver a preguntarlos.
- Cuando la persona te cuente un dato de su negocio o te pase material de marca (logo, manual de marca en PDF, imágenes de su identidad), guardalo en "memory". Solo datos reales que te dio: nunca inventes.
- Si te pasa un manual de marca o imágenes de su identidad, extraé: colores (con su uso), tipografías, reglas del logo, estilo visual y tono. Contale en una frase qué guardaste ("Listo, guardé tu identidad de marca: …").
- Si falta un dato necesario para que algo funcione (ej.: el WhatsApp para el botón), preguntalo en ese momento.
- Si la persona dice que un dato cambió, actualizalo en "memory".
- Claves posibles de "memory" (usá solo las que correspondan): nombre, rubro, descripcion, razon_social, cuit, matricula, whatsapp, email, telefono, direccion, zona, horarios, redes (objeto: instagram, facebook, tiktok, linkedin, web…), servicios, formas_de_pago, logo_url, marca (objeto: colores, tipografias, reglas_logo, estilo, tono), notas.

LA APP QUE GENERÁS
- Un único documento HTML completo (<!doctype html> ... </html>), con CSS y JS adentro. Podés usar Google Fonts y <script src="https://cdn.tailwindcss.com"></script>. Nada de otros servidores.
- REGLA OBLIGATORIA: la app tiene que funcionar y verse perfecta al 100% en CELULAR y en COMPU. No es una página de celular estirada:
    · Celular (360–430 px): una columna, botones grandes (mínimo 44 px de alto), menú compacto, nada que se salga de la pantalla ni scroll horizontal.
    · Compu (1024–1920 px): aprovechá el ancho con columnas, tablas y paneles; contenido centrado con ancho máximo cómodo (no textos de lado a lado).
    · Usá diseño adaptable (CSS grid/flex, media queries o clases responsive de Tailwind: sm:, md:, lg:). Tablas anchas con desplazamiento propio en celular.
    · Si la usan distintas personas (ej.: empleado pide desde el celular, RRHH aprueba desde la compu), pensá cada pantalla para el dispositivo que más se usa, pero que igual funcione en el otro.
  Antes de responder, revisá mentalmente la app en un celular de 375 px y en una compu de 1440 px y corregí lo que falle.
- Diseño profesional y moderno, con buena tipografía, colores armónicos, botones grandes y textos reales (nunca lorem ipsum). En español.
- Para guardar datos (turnos, consultas, pedidos, puntajes) usá SIEMPRE el objeto global window.contala, que ya está disponible:
    await contala.save('consultas', { nombre, mensaje })   // guarda un registro; el dueño lo ve en su panel
    await contala.list('public_ranking')                    // lee registros; SOLO funciona con colecciones que empiezan con "public_"
  Los nombres de colección van en minúscula, sin espacios. Datos privados (consultas, turnos, pedidos) nunca en colecciones "public_".
  Mostrá siempre un mensaje claro de éxito o de error al guardar. No uses localStorage para datos importantes.
- MAILS AUTOMÁTICOS: cada vez que alguien guarda un formulario desde la app publicada, Contala le manda un aviso por mail al dueño con los datos. Si el formulario tiene un campo "email", la persona que lo completó recibe además un mail de confirmación. Por eso, en formularios de contacto, turnos, pedidos o inscripciones incluí un campo "email" (podés hacerlo opcional) y contale al usuario que los avisos por mail ya funcionan.
- Si el usuario sumó imágenes, usá sus direcciones (URL) tal cual te las paso.
- Para WhatsApp, usá enlaces https://wa.me/NUMERO?text=... ; para mapas, un enlace a Google Maps.

FORMATO DE RESPUESTA
Respondé SOLO con un objeto JSON válido, sin texto antes ni después:
{"reply": "lo que le decís al usuario (corto, cálido, sin listas largas: las mejoras van en ideas)", "title": "nombre corto de la app o null", "html": "documento HTML completo o null si no cambiaste nada", "ideas": [{"title": "mejora en pocas palabras", "why": "por qué le conviene, en una frase"}], "memory": {"clave": "valor nuevo o actualizado"} o null si no hay datos nuevos, "suggestions": ["...", "..."]}`;

function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return 'mock';
}

// history: [{role:'user'|'assistant', content}] ; current: HTML actual ; images: [{mime, base64, url}]
async function chat({ history, message, currentHtml, images = [], business = {} }) {
  const p = provider();
  const pics = images.filter(i => i.mime.startsWith('image/'));
  const docs = images.filter(i => i.mime === 'application/pdf');
  const ctx = `DATOS DEL NEGOCIO (memoria): ${Object.keys(business).length ? JSON.stringify(business) : 'todavía no hay datos guardados'}\n\n` +
    (currentHtml ? `APP ACTUAL (HTML):\n${currentHtml}\n\n` : 'Todavía no hay app armada.\n\n') +
    (pics.length ? `IMÁGENES QUE SUMÓ EL USUARIO (usá estas URL tal cual en la app): ${pics.map(i => i.url).join(', ')}\n\n` : '') +
    (docs.length ? `EL USUARIO ADJUNTÓ ${docs.length} PDF (${docs.map(d => d.name || 'documento').join(', ')}): leelo y usá lo que sirva; si es material de marca o datos del negocio, guardalo en memory.\n\n` : '') +
    `MENSAJE DEL USUARIO: ${message}`;
  let raw;
  if (p === 'gemini') raw = await gemini(history, ctx, images);
  else if (p === 'claude') raw = await claude(history, ctx, images);
  else return mock(message, currentHtml, images);
  return parse(raw);
}

async function gemini(history, ctx, images, system = SYSTEM, maxTokens = 32000) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  contents.push({ role: 'user', parts: [...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), { text: ctx }] });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: maxTokens },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || r.status));
  return (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
}

async function claude(history, ctx, images, system = SYSTEM, maxTokens = 32000) {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
  const messages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  messages.push({ role: 'user', content: [...images.map(i => ({ type: i.mime === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })), { type: 'text', text: ctx }] });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Claude: ' + (j.error?.message || r.status));
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function parse(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const o = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    return {
      reply: String(o.reply || 'Listo.'),
      title: o.title ? String(o.title).slice(0, 150) : null,
      html: typeof o.html === 'string' && /<html|<!doctype/i.test(o.html) ? o.html : null,
      suggestions: Array.isArray(o.suggestions) ? o.suggestions.slice(0, 4).map(String) : [],
      memory: o.memory && typeof o.memory === 'object' && !Array.isArray(o.memory) ? o.memory : null,
      ideas: Array.isArray(o.ideas) ? o.ideas.filter(i => i && i.title).slice(0, 4).map(i => ({ title: String(i.title).slice(0, 120), why: String(i.why || '').slice(0, 240) })) : [],
    };
  } catch (e) {
    const m = s.match(/<!doctype html[\s\S]*<\/html>/i);
    return { reply: m ? 'Listo, actualicé tu app.' : 'Perdón, no te entendí bien. ¿Me lo contás de otra forma?', title: null, html: m ? m[0] : null, suggestions: [], ideas: [], memory: null };
  }
}

// IA simulada: permite probar todo el circuito sin clave.
function mock(message, currentHtml, images) {
  const wa = message.match(/whats\w*\D{0,20}(\+?[\d ]{8,})/i);
  const memory = wa ? { whatsapp: wa[1].trim() } : (images.some(i => i.mime === 'application/pdf') ? { marca: { notas: 'Manual de marca recibido (IA simulada)' } } : null);
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const title = currentHtml ? null : message.slice(0, 40);
  const color = /verde/i.test(message) ? '#2F7D6B' : /azul/i.test(message) ? '#2D4E8A' : /naranja/i.test(message) ? '#C2571A' : '#0B6E68';
  const name = title || (currentHtml?.match(/<h1[^>]*>([^<]*)/)?.[1]) || 'Mi app';
  const img = images.find(i => i.mime.startsWith('image/')) ? `<img src="${images.find(i => i.mime.startsWith('image/')).url}" alt="" style="max-width:120px;border-radius:12px">` : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;color:#1b1f24}header{background:${color};color:#fff;padding:40px 20px}h1{margin:0 0 8px}main{padding:20px;max-width:640px;margin:auto}input,textarea{width:100%;padding:12px;border:1px solid #ccd;border-radius:10px;margin:6px 0;font:inherit;box-sizing:border-box}button{background:${color};color:#fff;border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:600}#ok{color:#1E7F45;font-weight:600}</style></head>
<body><header>${img}<h1>${esc(name)}</h1><p>App de prueba generada por la IA simulada de Contala.</p></header>
<main><h2>Dejanos tu consulta</h2><form id="f"><input name="nombre" placeholder="Tu nombre" required><input name="email" type="email" placeholder="Tu mail (opcional)"><textarea name="mensaje" placeholder="Tu mensaje" required></textarea><button>Enviar</button></form><p id="ok"></p>
<p style="color:#666;font-size:.9em">Último pedido: ${esc(message)}</p></main>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await contala.save('consultas',d);e.target.reset();document.getElementById('ok').textContent='¡Gracias! Recibimos tu consulta.'}catch(x){document.getElementById('ok').textContent='No se pudo enviar. Probá de nuevo.'}}</script></body></html>`;
  return { memory, reply: memory ? 'Listo, lo guardé en los datos de tu negocio. (IA simulada)' : currentHtml ? 'Listo, apliqué el cambio. (IA simulada: conectá Gemini para resultados reales.)' : 'Armé una primera versión. (IA simulada: conectá Gemini para resultados reales.) ¿Qué color te gusta?', title, html, suggestions: currentHtml ? ['Verde', 'Azul', 'Naranja'] : ['Investigá mi competencia', 'Verde', 'Azul'], ideas: currentHtml ? [] : [{ title: 'Recordatorio el día anterior', why: 'Baja mucho las ausencias.' }, { title: 'Botón de WhatsApp', why: 'Te escriben con un toque, sin buscar tu número.' }] };
}

// Revisión nocturna: el "equipo" (Consultor + UX + QA + Seguridad) mira la app y propone 2–3 mejoras concretas.
const REVIEW = `Sos el equipo de Contala que revisa de noche las apps de los usuarios: un consultor de negocio del rubro, un experto en UX/UI, un revisor de calidad (QA) y un auditor de seguridad y privacidad.
Te paso la app (HTML), los datos del negocio y lo último que charló la persona. Proponé de 1 a 3 sugerencias MUY concretas y valiosas para que la app funcione o venda mejor. Tipos posibles:
- Funciones del rubro que faltan (ej.: recordatorio de turnos, botón de WhatsApp, horarios, mapa, preguntas frecuentes).
- Problemas detectados: algo que no funciona, botones de adorno, textos de relleno, algo que se ve mal en celular o en compu.
- Diseño y claridad: jerarquía, contraste, llamado a la acción poco visible.
- Privacidad y seguridad: datos sensibles en formularios, datos que faltan en el pie (razón social, contacto).
No repitas sugerencias ya hechas (te paso la lista). Si la app está muy bien, devolvé menos o ninguna. Español rioplatense, sin tecnicismos.
Respondé SOLO JSON: {"suggestions":[{"title":"máx. 8 palabras","why":"beneficio concreto en una frase","ask":"pedido exacto para aplicar el cambio, escrito como lo diría la persona (ej.: Sumá un botón de WhatsApp flotante con el mensaje 'Hola, quiero un turno')"}]}`;

async function review({ html, business = {}, history = [], previous = [] }) {
  const p = provider();
  if (p === 'mock') return [{ title: 'Sumá tus horarios de atención', why: 'La gente sabe cuándo puede contactarte y llama menos.', ask: 'Agregá una sección con mis horarios de atención' }, { title: 'Botón de WhatsApp siempre visible', why: 'Te escriben con un toque desde el celular.', ask: 'Sumá un botón flotante de WhatsApp' }].filter(x => !previous.includes(x.title));
  const ctx = `DATOS DEL NEGOCIO: ${JSON.stringify(business)}\n\nSUGERENCIAS YA HECHAS (no repetir): ${previous.join(' | ') || 'ninguna'}\n\nÚLTIMOS MENSAJES:\n${history.map(m => (m.role === 'assistant' ? 'Contala: ' : 'Persona: ') + m.content.slice(0, 300)).join('\n')}\n\nAPP (HTML):\n${html}`;
  const raw = p === 'gemini' ? await gemini([], ctx, [], REVIEW, 2000) : await claude([], ctx, [], REVIEW, 2000);
  try {
    const s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const o = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    return (o.suggestions || []).filter(x => x && x.title && x.ask).slice(0, 3).map(x => ({ title: String(x.title).slice(0, 120), why: String(x.why || '').slice(0, 300), ask: String(x.ask).slice(0, 500) }));
  } catch { return []; }
}

// Estudio de mercado: el Investigador busca en internet competidores y referentes del rubro y la zona.
const MARKET = `Sos el Investigador de mercado de Contala. La persona está creando una app para su negocio. Buscá en internet (usá la búsqueda) competidores y referentes de su rubro, priorizando su país/zona (por defecto Argentina), y analizá qué ofrecen sus sitios y apps.
Entregá un informe útil y honesto, en español rioplatense simple, sin tecnicismos. No inventes empresas ni datos: si no encontrás algo, decilo. Inspirate en funciones, nunca copies marcas ni textos.
Respondé SOLO con JSON válido (sin texto antes ni después):
{"rubro":"...","zona":"...","resumen":"2-3 frases con lo más importante",
"competidores":[{"nombre":"...","url":"https://...","ofrece":"qué tiene su sitio/app, en una frase"}],
"imprescindibles":["funciones que tienen casi todos en el rubro"],
"diferenciales":["funciones que tienen pocos y suman"],
"oportunidades":["lo que nadie hace bien o la gente reclama"],
"tendencias":["cómo se vende y se usa hoy en el rubro"],
"ideas":[{"title":"máx. 8 palabras","why":"por qué conviene, citando lo que viste en el mercado","ask":"pedido exacto para sumarlo a la app"}]}
Máximo 5 competidores, 5 ítems por lista y 5 ideas. Las ideas tienen que ser cosas que la app de la persona todavía NO tiene.`;

function parseJSON(raw) {
  const s = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}

async function market({ projectName, business = {}, html, history = [] }) {
  const p = provider();
  const ctx = `APP: ${projectName}\nDATOS DEL NEGOCIO: ${JSON.stringify(business)}\nLO QUE CONTÓ LA PERSONA:\n${history.filter(m => m.role === 'user').map(m => '- ' + m.content.slice(0, 300)).join('\n')}\n\nAPP ACTUAL (resumen del HTML, para no sugerir lo que ya tiene):\n${String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)}`;
  let raw = '', sources = [];
  if (p === 'mock') {
    return { rubro: 'Psicología', zona: 'Argentina', resumen: 'Informe de prueba (IA simulada): conectá Gemini para un estudio real con búsqueda en internet.', competidores: [{ nombre: 'Ejemplo de consultorio online', url: 'https://example.com', ofrece: 'Turnos online y sesiones por videollamada.' }],
      imprescindibles: ['Reserva de turnos online', 'Botón de WhatsApp'], diferenciales: ['Recordatorios automáticos'], oportunidades: ['Pocos explican claramente los precios'], tendencias: ['Atención online y presencial'],
      ideas: [{ title: 'Preguntas frecuentes', why: 'Los referentes del rubro responden dudas antes del primer contacto.', ask: 'Agregá una sección de preguntas frecuentes con las dudas típicas de mis pacientes' }], sources: [{ title: 'Ejemplo', url: 'https://example.com' }] };
  }
  if (p === 'gemini') {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: MARKET }] }, contents: [{ role: 'user', parts: [{ text: ctx }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.4, maxOutputTokens: 6000 } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || r.status));
    const c = j.candidates?.[0];
    raw = (c?.content?.parts || []).map(x => x.text || '').join('');
    sources = (c?.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(Boolean).map(w => ({ title: w.title, url: w.uri }));
  } else {
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 6000, system: MARKET, messages: [{ role: 'user', content: ctx }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Claude: ' + (j.error?.message || r.status));
    raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    for (const b of j.content || []) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content) if (x.url) sources.push({ title: x.title, url: x.url });
  }
  const o = parseJSON(raw);
  const list = (a, n = 5) => (Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, 300)) : []);
  const seen = new Set();
  return {
    rubro: String(o.rubro || '').slice(0, 80), zona: String(o.zona || '').slice(0, 80), resumen: String(o.resumen || '').slice(0, 800),
    competidores: (o.competidores || []).slice(0, 5).map(c => ({ nombre: String(c.nombre || '').slice(0, 120), url: /^https?:\/\//.test(c.url || '') ? String(c.url).slice(0, 400) : '', ofrece: String(c.ofrece || '').slice(0, 300) })),
    imprescindibles: list(o.imprescindibles), diferenciales: list(o.diferenciales), oportunidades: list(o.oportunidades), tendencias: list(o.tendencias),
    ideas: (o.ideas || []).filter(i => i && i.title && i.ask).slice(0, 5).map(i => ({ title: String(i.title).slice(0, 120), why: String(i.why || '').slice(0, 300), ask: String(i.ask).slice(0, 500) })),
    sources: sources.filter(x => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 10),
  };
}

// Estudiar y mejorar: analiza un sitio de referencia (ya recorrido por crawl.js) y propone qué hacer mejor.
const STUDY = `Sos el equipo de Contala (consultor del rubro, UX/UI, QA y seguridad). La persona te pasó el link de un sitio o app de referencia para hacer algo similar o mejor. Te paso lo que se ve en hasta 5 páginas públicas de ese sitio.
Analizá: qué hace y para quién, qué funciones tiene, el recorrido del usuario, el diseño (claridad, jerarquía, celular), y qué se podría hacer mejor.
Reglas: español rioplatense simple, sin tecnicismos. Honestidad: solo ves lo público (no lo que está detrás de un login ni cómo funciona por dentro); si algo lo deducís, decilo. Inspirate en funciones y estructura, NUNCA copies marca, logo, textos ni fotos: la app de la persona lleva su propia identidad.
Respondé SOLO JSON:
{"sitio":"nombre o dominio","resumen":"qué es y qué hace, 2 frases",
"funciones":["funciones detectadas"],"bien":["lo que hace bien y conviene mantener"],"mejorar":["lo que se puede hacer mejor"],
"propuesta":[{"tipo":"funcion|mejora|idea","title":"máx. 8 palabras","why":"por qué, en una frase","ask":"pedido exacto para construirlo en la app de la persona"}],
"limites":"qué no pudiste ver (si aplica)"}
Máximo 6 ítems por lista y entre 4 y 8 en propuesta (primero las funciones clave a replicar, después mejoras, después ideas nuevas).`;

async function study({ crawl, message, business = {}, html }) {
  const p = provider();
  if (p === 'mock') return { sitio: crawl.site, resumen: 'Análisis de prueba (IA simulada): conectá Gemini para un estudio real.', funciones: (crawl.pages[0]?.nav || []).slice(0, 4), bien: ['Se entiende rápido qué ofrece'], mejorar: ['El botón de contacto no se ve en el celular'], propuesta: [{ tipo: 'funcion', title: 'Página de servicios', why: 'Es lo más visitado del sitio.', ask: 'Sumá una sección de servicios como la del sitio de referencia, con mis servicios' }, { tipo: 'mejora', title: 'Botón de WhatsApp siempre visible', why: 'En el sitio de referencia cuesta encontrar el contacto.', ask: 'Agregá un botón flotante de WhatsApp' }], limites: '' };
  const ctx = `PEDIDO DE LA PERSONA: ${message}\nDATOS DE SU NEGOCIO: ${JSON.stringify(business)}\nSU APP ACTUAL: ${html ? 'ya tiene una versión armada' : 'todavía no tiene app'}\n\nSITIO DE REFERENCIA (${crawl.site})${crawl.thin ? ' — ATENCIÓN: el sitio devolvió muy poco contenido (probablemente se arma con JavaScript); avisale que con capturas de pantalla el análisis sale mejor' : ''}:\n` +
    crawl.pages.map((pg, i) => `--- Página ${i + 1}: ${pg.url}\nTítulo: ${pg.title}\nDescripción: ${pg.description}\nMenú: ${pg.nav.join(' | ')}\nTítulos: ${pg.headings.join(' | ')}\nBotones: ${pg.buttons.join(' | ')}\nFormularios (campos): ${pg.forms.join(' / ') || 'ninguno'}\nEnlaces externos: ${pg.external.join(' | ') || 'ninguno'}\nImágenes: ${pg.images} · Preparada para celular: ${pg.mobileReady ? 'sí' : 'no'}\nTexto: ${pg.text}`).join('\n\n');
  const raw = p === 'gemini' ? await gemini([], ctx, [], STUDY, 5000) : await claude([], ctx, [], STUDY, 5000);
  const o = parseJSON(raw);
  const list = a => (Array.isArray(a) ? a.slice(0, 6).map(x => String(x).slice(0, 300)) : []);
  return {
    sitio: String(o.sitio || crawl.site).slice(0, 120), resumen: String(o.resumen || '').slice(0, 600),
    funciones: list(o.funciones), bien: list(o.bien), mejorar: list(o.mejorar), limites: String(o.limites || '').slice(0, 300),
    propuesta: (o.propuesta || []).filter(x => x && x.title && x.ask).slice(0, 8).map(x => ({ tipo: ['funcion', 'mejora', 'idea'].includes(x.tipo) ? x.tipo : 'idea', title: String(x.title).slice(0, 120), why: String(x.why || '').slice(0, 300), ask: String(x.ask).slice(0, 500) })),
  };
}

// Redactor comercial (SDR): escribe un mensaje de WhatsApp o mail para un lead, para revisar antes de enviar.
const DRAFT = `Sos el Redactor comercial de Contala y ayudás a un SDR (vendedor) a escribirle a un posible cliente.
Escribí UN mensaje corto, humano y personalizado, en español rioplatense profesional (tuteo cordial, sin exagerar). Nada de presión, mayúsculas, emojis en exceso ni promesas que no se puedan cumplir.
Usá solo los datos que te paso: no inventes datos del lead, de su empresa, precios, casos de éxito ni nombres. Si falta algo, escribí un mensaje que funcione igual.
Tené en cuenta el historial para no repetir lo ya dicho. Terminá con una pregunta concreta y fácil de responder (ej.: proponer dos horarios para una llamada de 15 minutos).
WhatsApp: máximo 450 caracteres, sin asunto. Mail: asunto de máximo 8 palabras y cuerpo de máximo 120 palabras, firmado con el nombre del vendedor; en un primer contacto por mail sumá al final una línea corta para que pueda pedir no recibir más mensajes.
Respondé SOLO JSON: {"subject":"(solo mail, si no vacío)","text":"el mensaje","tip":"un consejo breve para el vendedor sobre este lead (máx. 20 palabras)"}`;

async function draft({ org, product, lead, activities = [], channel = 'whatsapp', goal = 'primer contacto', sender = '', extra = '' }) {
  const p = provider(), first = String(lead.name || '').split(' ')[0];
  if (p === 'mock') {
    const text = channel === 'mail'
      ? `Hola ${first}, ¿cómo estás?\n\nSoy ${sender}, de ${org}. ${product ? 'Ayudamos a empresas como ' + (lead.company || 'la tuya') + ' con ' + product.slice(0, 120) + '.' : 'Te escribo porque creo que podemos ayudarte.'}\n\n¿Te parece si lo charlamos 15 minutos esta semana? Decime qué día te queda cómodo.\n\nSaludos,\n${sender}\n\nSi preferís no recibir más mensajes, respondé "no" y no te escribimos más.`
      : `Hola ${first}, soy ${sender} de ${org}. ${goal === 'seguimiento' ? 'Te escribo para retomar lo que hablamos.' : 'Te escribo porque creo que te podemos ayudar' + (lead.company ? ' en ' + lead.company : '') + '.'} ¿Tenés 15 minutos esta semana para una llamada corta?`;
    return { subject: channel === 'mail' ? `${org}: una idea para ${lead.company || first}` : '', text, tip: 'Mensaje de prueba (IA simulada). Conectá Gemini para mensajes personalizados.' };
  }
  const hist = activities.map(a => `- ${String(a.created_at).slice(0, 10)} ${a.kind}: ${String(a.note || '').slice(0, 200)}`).join('\n') || 'sin contactos previos';
  const ctx = `EMPRESA DEL VENDEDOR: ${org}\nQUÉ VENDE / PROPUESTA: ${product || 'no la cargaron'}\nVENDEDOR: ${sender}\nCANAL: ${channel}\nOBJETIVO: ${goal}\n${extra ? 'INDICACIÓN DEL VENDEDOR: ' + extra + '\n' : ''}
LEAD: ${JSON.stringify({ nombre: lead.name, empresa: lead.company, cargo: lead.position, origen: lead.source, etiquetas: lead.tags, etapa: lead.stage, notas: String(lead.notes || '').slice(0, 800) })}
HISTORIAL:\n${hist}`;
  const raw = p === 'gemini' ? await gemini([], ctx, [], DRAFT, 1500) : await claude([], ctx, [], DRAFT, 1500);
  const o = parseJSON(raw);
  return { subject: String(o.subject || '').slice(0, 150), text: String(o.text || '').slice(0, 3000), tip: String(o.tip || '').slice(0, 200) };
}

module.exports = { chat, provider, review, market, study, draft };
