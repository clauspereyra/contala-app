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

## Desarrollo local
```
cp .env.example .env   # completar
npm install
npm start               # http://localhost:3000
```
