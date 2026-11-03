# Contala

Creá tu app conversando con IA. Node.js + Express + MySQL, pensado para correr en cPanel ("Setup Node.js App").

## Qué hace
- Registro e ingreso con mail y contraseña.
- Charla con la IA (Gemini, Claude o una IA simulada) que arma la app y la muestra en vivo (celular / compu).
- Cada cambio queda como versión; se puede volver atrás.
- Publicación en `tudominio.com/app/nombre`.
- Las apps pueden guardar datos (consultas, turnos, pedidos) y el dueño los ve en "Datos recibidos".
- Las apps publicadas corren aisladas (sandbox): no pueden leer la sesión de Contala.

## Instalación en cPanel (una sola vez)

### 1. Base de datos
cPanel > **MySQL® Databases**:
1. Crear base: `contala` (queda `usuario_contala`).
2. Crear usuario con contraseña segura.
3. Agregar el usuario a la base con **ALL PRIVILEGES**.
Las tablas se crean solas al arrancar.

### 2. Código (Git)
1. Subí esta carpeta a un repositorio de GitHub (ej. `contala`).
2. cPanel > **Git™ Version Control** > **Create** > Clone a Repository:
   - Clone URL: `https://github.com/TU_USUARIO/contala.git` (repo privado: usar URL SSH y cargar la clave de cPanel como Deploy Key en GitHub).
   - Repository Path: `contala`  →  queda en `/home/USUARIO/contala`

### 3. App Node.js
cPanel > **Setup Node.js App** > **Create Application**:
- Node.js version: la más nueva disponible (18 o superior).
- Application mode: Production
- Application root: `contala`
- Application URL: recomendado un subdominio (`contala.tudominio.com`). Si usás una subcarpeta (`tudominio.com/contala`), agregá la variable `BASE_PATH=/contala`.
  No la instales en la raíz de un dominio que ya tiene un sitio: lo reemplazaría.
- Application startup file: `app.js`
- Environment variables: las de `.env.example` (DB_*, SESSION_SECRET, AI_PROVIDER, GEMINI_API_KEY…).
Guardar → **Run NPM Install** → **Restart**.

### 4. HTTPS
cPanel > **SSL/TLS Status** > **Run AutoSSL**.

## Actualizar
1. Subir cambios a GitHub.
2. cPanel > Git™ Version Control > Manage > **Pull or Deploy** > **Update from Remote** y luego **Deploy HEAD Commit** (instala dependencias y reinicia la app usando `.cpanel.yml`).
   Antes de la primera vez, editá `.cpanel.yml` con tu usuario, carpeta y versión de Node.
   Alternativa: en Setup Node.js App, tocar **Restart**.

## IA
- **Gemini** (por defecto): clave gratis en https://aistudio.google.com/apikey → `GEMINI_API_KEY`.
- **Claude**: clave en https://console.anthropic.com → `AI_PROVIDER=claude` y `ANTHROPIC_API_KEY`.
- **Simulada**: `AI_PROVIDER=mock` para probar todo sin clave.
- `DAILY_AI_LIMIT` limita mensajes por usuario por día (cuida costos).

## Mails (Resend)
1. Crear cuenta en https://resend.com → **Domains** → **Add Domain** (ej.: `jlm-agency.com`).
2. Copiar los registros DNS que muestra Resend (TXT/MX de "send" y el TXT de DKIM) en cPanel > **Zone Editor** del dominio. No tocar los MX del correo principal.
3. Cuando Resend marque el dominio como **Verified**, crear una clave en **API Keys**.
4. En Setup Node.js App agregar `RESEND_API_KEY` y `MAIL_FROM` (ej.: `avisos@jlm-agency.com`) y reiniciar.
- Aviso al dueño en cada envío de formulario desde la app publicada (no desde la vista previa).
- Confirmación a quien completó el formulario si dejó su mail.
- `MAIL_DAILY_LIMIT` limita mails por app por día (por defecto 200).

## Sugerencias nocturnas ("mientras dormís")
1. En Setup Node.js App agregar `CRON_SECRET` con una clave larga inventada (ej.: `noche-contala-8h2k9`) y reiniciar.
2. cPanel > **Cron Jobs** > agregar uno **una vez por día** (ej.: 4:00 → minuto `0`, hora `4`, resto `*`) con el comando:
   `curl -s "https://contala.jlm-agency.com/api/cron/nightly?key=TU_CRON_SECRET" > /dev/null`
- Revisa las apps con actividad en los últimos 7 días, deja hasta 3 sugerencias por persona por día y manda un resumen por mail a la mañana (cada uno puede apagarlo desde la campanita).
- `NIGHTLY_MAX` limita cuántas apps se revisan por noche (por defecto 30) para cuidar el costo de IA.
- El botón **Revisar mi app** hace la misma revisión en el momento.

## Desarrollo local
```
cp .env.example .env   # completar
npm install
npm start               # http://localhost:3000
```

## Estudiar y mejorar desde un link
Si la persona pega un link en la charla, Contala recorre hasta 5 páginas públicas de ese sitio y propone qué replicar y qué mejorar (con casillas para elegir).
Seguridad: solo sitios públicos (http/https, puertos 80/443); bloquea direcciones internas. `CRAWL_ALLOW_PRIVATE=1` existe solo para pruebas locales: **no usarla en producción**.

## Dominio propio de los clientes (fase 1, asistida)
1. En la pestaña **Publicación**, el cliente escribe su dominio y Contala le muestra los registros DNS: `CNAME www → contala.jlm-agency.com` y `A @ → IP del servidor`.
2. Toca **Verificar**. Cuando el DNS apunta bien, Contala le manda un mail a `ADMIN_EMAIL` con los pasos.
3. Nuestro equipo, en cPanel: **Dominios → Crear dominio** (o alias) con la misma raíz que `contala.jlm-agency.com`, y **SSL/TLS Status → Run AutoSSL**.
4. Con la primera visita por ese dominio, queda **activo** y muestra la app publicada.
Variables: `ADMIN_EMAIL` (a quién avisar), `PLATFORM_HOSTS=contala.jlm-agency.com` (dominios de la plataforma, para no confundirlos con los de clientes) y opcional `SERVER_IP` (si el subdominio usa proxy/CDN).

## Panel de expertos (equipo humano de Contala)
- `EXPERT_EMAILS` = mails del equipo separados por coma (si no está, usa `ADMIN_EMAIL`). Esas personas, al ingresar a Contala con ese mail, ven **Panel experto** en el menú.
- El panel muestra números generales, los **pedidos de ayuda** (cuando la persona toca "Pedir ayuda a una persona", cuando pide ayuda con su dominio o cuando la IA falla 2 veces seguidas) y todas las apps.
- Desde una app, el experto ve la vista previa, la charla y los datos del negocio, y deja una sugerencia: llega a la campanita ("De nuestro equipo"), a la charla (con botón "Aplicar") y por mail.

## CRM de ventas / SDR (portal en /s/<equipo>)
- Se crea desde **Mis apps → + CRM de ventas**. Quien lo crea es **Líder**; desde **Equipo** invita a los SDR (les llega un mail para elegir contraseña).
- **Hoy:** seguimientos del día y vencidos, y leads nuevos sin contactar. **Tablero:** embudo Nuevo → Contactado → Interesado → Reunión → Ganado / Perdido (arrastrar en compu, elegir etapa en el celular).
- **Leads:** búsqueda y filtros, alta manual, **importación de CSV o filas pegadas de Excel** (detecta columnas y saltea repetidos por mail o teléfono, pide confirmar el origen de los datos), reasignación en bloque, exportar a Excel.
- **Ficha del lead:** llamar, WhatsApp, mail, registrar contacto con próximo seguimiento, historial y **mensaje escrito con IA** (WhatsApp o mail) para revisar antes de enviar.
- **Formulario público** (Ajustes): link e iframe para la web; los leads entran solos, con consentimiento, y se reparten entre los SDR.
- **Resultados:** leads nuevos, contactados, reuniones, ganados, conversión, valor, embudo, origen, motivos de pérdida y ranking del equipo.
- El Cron nocturno (`/api/cron/nightly`) también manda a cada SDR el resumen de sus seguimientos del día.
- Un SDR ve solo sus leads (validado en el servidor); el líder ve todo.
