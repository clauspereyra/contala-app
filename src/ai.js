// IA de Contala: Gemini, Claude o una IA simulada para pruebas.
// Se elige con AI_PROVIDER (gemini | claude | mock). Si no se indica, usa la que tenga clave.

const SYSTEM = `Sos el asistente de Contala, una plataforma donde cualquier persona crea su app conversando, sin saber programar.
Hablás en español rioplatense (voseo), cálido y claro, con frases cortas. Nunca usás términos técnicos (nada de HTML, código, base de datos, deploy). Tus usuarios pueden tener 10 o 72 años, ser profesionales, oficios o empresas.

CÓMO TRABAJÁS
- Desde el primer mensaje armás una primera versión de la app, aunque falten datos: es mejor mostrar algo rápido. Después preguntás UNA sola cosa por vez para mejorarla.
- Si el usuario pide un cambio, lo hacés y le contás en una frase qué cambiaste.
- Si algo no funciona, pedile que te cuente qué tocó y qué esperaba, y corregilo.
- Ofrecé de 2 a 4 respuestas sugeridas, cortas (máx. 6 palabras), para que pueda tocar en vez de escribir.
- Si algo no se puede hacer todavía (pagos reales, mandar mails, WhatsApp automático, apps en tiendas), decilo con honestidad y ofrecé una alternativa (ej.: botón que abre WhatsApp con un mensaje armado).
- No ayudes a crear sitios que imiten bancos, marcas o personas reales para engañar, ni formularios que pidan contraseñas o datos de tarjetas.

LA APP QUE GENERÁS
- Un único documento HTML completo (<!doctype html> ... </html>), con CSS y JS adentro. Podés usar Google Fonts y <script src="https://cdn.tailwindcss.com"></script>. Nada de otros servidores.
- Mobile-first, que se vea bien en celular y en compu. Si la usan distintas personas (ej.: empleado pide en el celular, RRHH aprueba en la compu), diseñá cada pantalla para su dispositivo.
- Diseño profesional y moderno, con buena tipografía, colores armónicos, botones grandes y textos reales (nunca lorem ipsum). En español.
- Para guardar datos (turnos, consultas, pedidos, puntajes) usá SIEMPRE el objeto global window.contala, que ya está disponible:
    await contala.save('consultas', { nombre, mensaje })   // guarda un registro; el dueño lo ve en su panel
    await contala.list('public_ranking')                    // lee registros; SOLO funciona con colecciones que empiezan con "public_"
  Los nombres de colección van en minúscula, sin espacios. Datos privados (consultas, turnos, pedidos) nunca en colecciones "public_".
  Mostrá siempre un mensaje claro de éxito o de error al guardar. No uses localStorage para datos importantes.
- Si el usuario sumó imágenes, usá sus direcciones (URL) tal cual te las paso.
- Para WhatsApp, usá enlaces https://wa.me/NUMERO?text=... ; para mapas, un enlace a Google Maps.

FORMATO DE RESPUESTA
Respondé SOLO con un objeto JSON válido, sin texto antes ni después:
{"reply": "lo que le decís al usuario", "title": "nombre corto de la app o null", "html": "documento HTML completo o null si no cambiaste nada", "suggestions": ["...", "..."]}`;

function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return 'mock';
}

// history: [{role:'user'|'assistant', content}] ; current: HTML actual ; images: [{mime, base64, url}]
async function chat({ history, message, currentHtml, images = [] }) {
  const p = provider();
  const ctx = (currentHtml ? `APP ACTUAL (HTML):\n${currentHtml}\n\n` : 'Todavía no hay app armada.\n\n') +
    (images.length ? `IMÁGENES QUE SUMÓ EL USUARIO (usá estas URL): ${images.map(i => i.url).join(', ')}\n\n` : '') +
    `MENSAJE DEL USUARIO: ${message}`;
  let raw;
  if (p === 'gemini') raw = await gemini(history, ctx, images);
  else if (p === 'claude') raw = await claude(history, ctx, images);
  else return mock(message, currentHtml, images);
  return parse(raw);
}

async function gemini(history, ctx, images) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  contents.push({ role: 'user', parts: [...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), { text: ctx }] });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 32000 },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || r.status));
  return (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
}

async function claude(history, ctx, images) {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
  const messages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  messages.push({ role: 'user', content: [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })), { type: 'text', text: ctx }] });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 32000, system: SYSTEM, messages }),
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
    };
  } catch (e) {
    const m = s.match(/<!doctype html[\s\S]*<\/html>/i);
    return { reply: m ? 'Listo, actualicé tu app.' : 'Perdón, no te entendí bien. ¿Me lo contás de otra forma?', title: null, html: m ? m[0] : null, suggestions: [] };
  }
}

// IA simulada: permite probar todo el circuito sin clave.
function mock(message, currentHtml, images) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const title = currentHtml ? null : message.slice(0, 40);
  const color = /verde/i.test(message) ? '#2F7D6B' : /azul/i.test(message) ? '#2D4E8A' : /naranja/i.test(message) ? '#C2571A' : '#0B6E68';
  const name = title || (currentHtml?.match(/<h1[^>]*>([^<]*)/)?.[1]) || 'Mi app';
  const img = images[0] ? `<img src="${images[0].url}" alt="" style="max-width:120px;border-radius:12px">` : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;color:#1b1f24}header{background:${color};color:#fff;padding:40px 20px}h1{margin:0 0 8px}main{padding:20px;max-width:640px;margin:auto}input,textarea{width:100%;padding:12px;border:1px solid #ccd;border-radius:10px;margin:6px 0;font:inherit;box-sizing:border-box}button{background:${color};color:#fff;border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:600}#ok{color:#1E7F45;font-weight:600}</style></head>
<body><header>${img}<h1>${esc(name)}</h1><p>App de prueba generada por la IA simulada de Contala.</p></header>
<main><h2>Dejanos tu consulta</h2><form id="f"><input name="nombre" placeholder="Tu nombre" required><textarea name="mensaje" placeholder="Tu mensaje" required></textarea><button>Enviar</button></form><p id="ok"></p>
<p style="color:#666;font-size:.9em">Último pedido: ${esc(message)}</p></main>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await contala.save('consultas',d);e.target.reset();document.getElementById('ok').textContent='¡Gracias! Recibimos tu consulta.'}catch(x){document.getElementById('ok').textContent='No se pudo enviar. Probá de nuevo.'}}</script></body></html>`;
  return { reply: currentHtml ? 'Listo, apliqué el cambio. (IA simulada: conectá Gemini para resultados reales.)' : 'Armé una primera versión. (IA simulada: conectá Gemini para resultados reales.) ¿Qué color te gusta?', title, html, suggestions: ['Verde', 'Azul', 'Naranja'] };
}

module.exports = { chat, provider };
