# CONTRATO.md — Fuente única de verdad

Proyecto: **El Observador** — portal de noticias de seguridad de la
provincia de Buenos Aires, Argentina.

Este documento es el contrato compartido entre todos los subagentes.
**Nadie lo modifica por su cuenta.** Si un subagente necesita cambiar algo
acá, debe reportarlo en su resumen final en vez de romper el contrato.

> ⚠️ **Restricción del entorno de desarrollo**: este sandbox de Claude
> Code tiene la salida de red bloqueada para dominios arbitrarios (solo
> están habilitados npm, GitHub y similares). Esto significa que **no se
> puede validar en vivo ningún feed RSS de medios argentinos durante el
> desarrollo**. El motor RSS debe programarse igual, completo y correcto,
> porque en producción (Railway) sí va a tener salida a internet normal.
> El Subagente D debe dejar el archivo `seeds/fuentes.js` con las fuentes
> que conozca marcadas explícitamente como **"no verificado en este
> entorno"**, nunca como confirmadas. No hay que perder tiempo reintentando
> peticiones de red que van a fallar siempre por política del entorno, no
> por el feed en sí.

---

## 1. Esquema de base de datos SQLite

```sql
CREATE TABLE IF NOT EXISTS noticias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  resumen TEXT NOT NULL,           -- máx 300 caracteres, sin HTML
  contenido_propio TEXT,           -- solo para noticias propias (es_propia = 1)
  imagen_url TEXT,
  link_original TEXT NOT NULL,
  fecha_publicacion TEXT NOT NULL, -- ISO 8601
  fuente_id INTEGER,               -- NULL si es_propia = 1
  fuente_nombre TEXT NOT NULL,     -- desnormalizado a propósito para lecturas rápidas
  categoria TEXT NOT NULL DEFAULT 'General',
  destacada INTEGER NOT NULL DEFAULT 0,   -- bool 0/1
  oculta INTEGER NOT NULL DEFAULT 0,      -- bool 0/1
  es_propia INTEGER NOT NULL DEFAULT 0,   -- bool 0/1
  vistas INTEGER NOT NULL DEFAULT 0,
  creada_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (fuente_id) REFERENCES fuentes(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_noticias_link ON noticias(link_original);
CREATE INDEX IF NOT EXISTS idx_noticias_fecha ON noticias(fecha_publicacion);
CREATE INDEX IF NOT EXISTS idx_noticias_categoria ON noticias(categoria);

CREATE TABLE IF NOT EXISTS fuentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  url_rss TEXT NOT NULL UNIQUE,
  sitio_web TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  ultima_lectura TEXT,
  ultimo_error TEXT,
  total_noticias INTEGER NOT NULL DEFAULT 0,
  creada_en TEXT NOT NULL DEFAULT (datetime('now')),
  categoria_default TEXT  -- si está seteada, todas las noticias de esta fuente usan esta categoría en vez del categorizador automático
);

CREATE TABLE IF NOT EXISTS publicidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  imagen_url TEXT NOT NULL,
  link_destino TEXT NOT NULL,
  posicion TEXT NOT NULL, -- header | sidebar | entre-noticias | footer
  activa INTEGER NOT NULL DEFAULT 1,
  impresiones INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  fecha_inicio TEXT,
  fecha_fin TEXT,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, -- info | error | rss
  mensaje TEXT NOT NULL,
  detalle TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suscriptores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,       -- usado en los links de confirmación y baja
  confirmado INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  confirmado_en TEXT
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'admin',
  ultimo_acceso TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Claves de `configuracion` (valores por defecto que debe insertar el seed):

| clave | valor por defecto |
|---|---|
| nombre_portal | El Observador |
| logo_url | (vacío) |
| color_primario | #c9a635 |
| color_acento | #c62828 |
| color_fondo | #0a0e1a |
| tamano_fuente_base | 16 (px; uno de: 14, 16, 18, 20) |
| intervalo_rss_minutos | 30 |
| noticias_por_pagina | 20 |
| texto_legal_footer | Este sitio agrega noticias de terceros con fines informativos. Cada tarjeta enlaza a la fuente original. No se reproduce el contenido completo de las notas. |

`nombre_portal`/`logo_url`/`color_primario`/`color_acento`/`color_fondo`/
`tamano_fuente_base`/`texto_legal_footer` son 100% editables desde el panel
admin (Configuración → Apariencia, `PUT /api/admin/config`) y el portal
público los aplica en tiempo real al cargar (ver `GET /api/tema` abajo y
`public/js/main.js`, función `aplicarTema`). Ninguno es azul por defecto
a propósito: el administrador pidió que la interfaz no lo sea.

---

## 2. Contrato de API REST

Formato de error unificado (siempre este shape cuando `error: true`):
```json
{ "error": true, "mensaje": "texto en español", "codigo": 400 }
```
Respuestas exitosas: JSON plano, sin envolver en `{data: ...}` salvo que se
indique explícitamente abajo. Fechas siempre ISO 8601.

### Pública (sin autenticación)

**GET /api/noticias?pagina=1&categoria=&limite=20&periodo=** — solo
noticias con `imagen_url` (las que no tienen imagen no se listan acá,
aunque siguen existiendo en la base y visibles desde el panel admin;
reaparecen solas si más adelante se les consigue una imagen). `GET
/api/buscar` es la excepción: ahí sí se listan también las noticias sin
imagen, porque el usuario está buscando un texto puntual. `periodo`
(opcional) filtra por antigüedad: uno de `1h`/`24h`/`7d`/`30d`; vacío u
omitido = sin filtro de fecha. 400 si no es uno de esos valores.
```json
{
  "noticias": [ { "id":1, "titulo":"...", "resumen":"...", "imagen_url":"...",
    "link_original":"...", "fecha_publicacion":"2026-09-18T10:00:00.000Z",
    "fuente_nombre":"...", "categoria":"Policial",
    "destacada":false, "es_propia":false } ],
  "total": 143, "pagina": 1, "totalPaginas": 8
}
```

**GET /api/noticias/destacada** → array de hasta 3 noticias con imagen
(las marcadas `destacada`, completando con las más recientes si hay
menos de 3 marcadas). El panel admin permite marcar hasta 3 noticias
como destacadas a la vez (`PATCH /api/admin/noticias/:id/destacar`); si
ya hay 3 y se marca una cuarta, se desmarca automáticamente la más
vieja.

**GET /api/noticias/:id** → detalle de una noticia. Incrementa `vistas`.
404 con el formato de error si no existe o está oculta.

**GET /api/categorias** → `["Policial","Político","Deportivo"]`
('General' existe como categoría interna de reserva del categorizador,
pero no se expone acá: no es una sección navegable del portal.)
(lista fija, ver categorizador).

**GET /api/buscar?q=texto&pagina=1&periodo=** → mismo shape que
`/api/noticias` (`periodo` con el mismo significado, pero acá sí se
listan noticias sin imagen).

**GET /api/tema** → apariencia configurada desde el panel admin, para
que el portal público la aplique al cargar:
```json
{
  "nombre_portal": "El Observador", "logo_url": "",
  "color_primario": "#c9a635", "color_acento": "#c62828",
  "color_fondo": "#0a0e1a", "tamano_fuente_base": "16",
  "texto_legal_footer": "..."
}
```
Subconjunto seguro de `configuracion` (nunca expone claves operativas
como `intervalo_rss_minutos`).

**GET /api/fuentes** → fuentes activas, solo `id, nombre, sitio_web`.

**GET /api/clima-dolar** → ticker de clima (La Plata) y cotización del
dólar, para el header del portal. Siempre responde 200 (nunca 500): si
alguna de las dos fuentes externas falla, esa parte viene en `null`.
```json
{
  "clima": { "temperatura": 18, "humedad": 60, "viento": 11 },
  "dolar": {
    "oficial": { "compra": 1030, "venta": 1035 },
    "blue": { "compra": 1050, "venta": 1055 }
  },
  "actualizado": "2026-09-18T15:00:00.000Z"
}
```
Cacheado 10 minutos en el servidor (`services/climaDolarService.js`) para
no golpear las APIs externas (Open-Meteo y Bluelytics) en cada visita.

**POST /api/suscriptores** → body `{email}`. Alta (o reactivación) de un
suscriptor con doble opt-in: crea la fila con `confirmado=0` y manda un
mail de confirmación vía `services/emailService.js` (Resend). Rate
limit: 5 solicitudes / 15 min / IP. Responde siempre
`{ ok: true, mensaje: "..." }` (nunca revela si el mail ya estaba
registrado).

**GET /api/suscriptores/confirmar?token=...** → se abre desde el link
del mail de confirmación (no es una llamada `fetch`, el navegador
navega directo ahí). Marca `confirmado=1` y devuelve una página HTML
simple de confirmación.

**GET /api/suscriptores/baja?token=...** → ídem, pero marca `activo=0`
(baja de la suscripción). También se abre directo desde el link del
mail.

**GET /api/publicidades?posicion=sidebar** → publicidades activas y
vigentes (fecha_inicio <= hoy <= fecha_fin o sin fechas) para esa posición.

**POST /api/publicidades/:id/click** → incrementa `clicks`. Responde `{ "ok": true }`.

**POST /api/publicidades/:id/impresion** → incrementa `impresiones`. Responde `{ "ok": true }`.

### Admin (requiere `Authorization: Bearer <token>`)

- **POST /api/admin/login** — body `{usuario, password}` → `{ "token":"...", "usuario":"admin" }`. 401 si falla. Rate limit 5 intentos / 15 min / IP.
- **GET /api/admin/verificar** → `{ "valido": true, "usuario":"admin" }` o 401.
- **GET /api/admin/stats** → `{ hoy, semana, total, fuentesActivas, suscriptoresActivos, ultimaLecturaRss, ultimoResultadoRss, porDia: [{fecha,cantidad}, ...7] }`.
- **GET /api/admin/noticias?pagina=&buscar=&categoria=&fuente=** → paginado, incluye ocultas y destacadas.
- **POST /api/admin/noticias** → crea noticia propia (`es_propia=1`, requiere `contenido_propio`).
- **PUT /api/admin/noticias/:id** → edita.
- **DELETE /api/admin/noticias/:id** → elimina.
- **PATCH /api/admin/noticias/:id/destacar** → alterna `destacada`.
- **PATCH /api/admin/noticias/:id/ocultar** → alterna `oculta`.
- **GET /api/admin/fuentes** → todas (activas e inactivas).
- **POST /api/admin/fuentes** → crea. Body: `{nombre, url_rss, sitio_web, categoria_default}` (`categoria_default` opcional; vacío/null = automático según palabras clave).
- **PUT /api/admin/fuentes/:id** → edita.
- **DELETE /api/admin/fuentes/:id** → elimina.
- **POST /api/admin/fuentes/validar** → body `{url_rss}`. Intenta leer el feed con timeout corto y devuelve `{ "valido":true, "titulos":["...","...","..."] }` o `{ "valido":false, "mensaje":"..." }`. Nunca tira 500 por un feed caído.
- **POST /api/admin/rss/actualizar** → body opcional `{fuente_id}` (si no viene, todas). Dispara lectura inmediata y devuelve resumen `{ fuentesLeidas, noticiasNuevas, errores:[...] }`.
- **GET /api/admin/publicidades** → todas.
- **POST /api/admin/publicidades** → crea.
- **PUT /api/admin/publicidades/:id** → edita.
- **DELETE /api/admin/publicidades/:id** → elimina.
- **GET /api/admin/config** → toda la tabla `configuracion` como objeto `{clave: valor}`.
- **PUT /api/admin/config** → body parcial `{clave: valor, ...}`, actualiza y si cambia `intervalo_rss_minutos` reprograma el cron.
- **PUT /api/admin/password** → body `{passwordActual, passwordNueva}`.
- **GET /api/admin/logs?limite=50** → últimos logs.

---

## 3. Estructura de carpetas

```
/
├── CONTRATO.md
├── package.json
├── server.js
├── .env.example
├── .gitignore
├── README.md
├── railway.json
├── Procfile
├── database/
│   ├── db.js
│   └── migraciones.js
├── routes/
│   ├── publico.js
│   └── admin.js
├── middleware/
│   ├── auth.js
│   └── errores.js
├── services/
│   ├── rssService.js
│   ├── categorizador.js
│   └── scheduler.js
├── seeds/
│   └── fuentes.js
├── public/
│   ├── index.html
│   ├── css/style.css
│   ├── js/main.js
│   └── img/placeholder.svg
└── admin/
    ├── index.html
    ├── css/admin.css
    └── js/admin.js
```

`data.db` (SQLite) se genera en runtime en la raíz del proyecto, nunca se
versiona (ver `.gitignore`).

---

## 4bis. Interfaces exactas entre módulos (para que A y D trabajen en paralelo sin acoplarse)

Estas firmas son fijas. Cada subagente programa contra esta interfaz aunque
el módulo de la otra punta todavía no exista.

**`database/db.js`** (lo escribe el Subagente A; lo consumen A y D) exporta:
```js
module.exports = {
  consultar(sql, params = []) { /* devuelve array de filas */ },
  consultarUno(sql, params = []) { /* devuelve una fila u undefined */ },
  ejecutar(sql, params = []) { /* INSERT/UPDATE/DELETE, devuelve {changes, lastInsertRowid} */ },
};
```
Usar `better-sqlite3` (síncrono, sin callbacks) como driver. `migraciones.js`
crea las tablas e inserta los seeds (usuario admin y configuración) si no
existen.

**`services/categorizador.js`** (lo escribe el Subagente D; lo consume D
internamente y opcionalmente A) exporta:
```js
module.exports = {
  categorizar(titulo, resumen) { /* devuelve el nombre de categoría, string */ },
  CATEGORIAS: ['Policial','Político','Deportivo','General'],
};
```

**`services/rssService.js`** (lo escribe el Subagente D; lo consume A desde
`routes/admin.js`) exporta:
```js
module.exports = {
  async actualizarTodas() { /* -> {fuentesLeidas, noticiasNuevas, errores:[{fuente,error}]} */ },
  async actualizarFuente(fuenteId) { /* -> {noticiasNuevas, error} */ },
  async validarFeed(urlRss) { /* -> {valido, titulos:[...hasta 3], mensaje} */ },
};
```

**`services/scheduler.js`** (lo escribe el Subagente D; lo consume A desde
`server.js` y desde `PUT /api/admin/config`) exporta:
```js
module.exports = {
  iniciar() { /* arma el cron con el intervalo actual de configuracion y hace una lectura inicial */ },
  reprogramar(minutos) { /* cancela el cron previo y lo vuelve a armar con el nuevo intervalo */ },
};
```

**`middleware/auth.js`** (lo escribe el Subagente A, uso interno de A) expone
`verificarToken` (middleware Express) y `generarToken(usuario)`.

El Subagente D **no** tiene que esperar a que exista `database/db.js` real:
puede escribir su código contra esta interfaz y, si necesita probarlo de
forma aislada, mockearla. La integración real la hace el coordinador en la
Fase 2.

---

## 4. Convenciones

- Nombres de columnas y tablas SQLite: `snake_case` (ya reflejado arriba).
- Variables y funciones JavaScript: `camelCase`.
- Todo el texto visible para el usuario (UI, mensajes de error, logs
  legibles): español.
- Manejo de errores: `try/catch` en todo handler async; los errores caen
  al middleware global de `middleware/errores.js`, que responde con el
  formato unificado.
- Consultas SQL: **siempre parametrizadas** (placeholders `?`), nunca
  concatenación de strings con datos de entrada.
- Toda ruta que reciba datos del cliente valida tipos y longitudes antes
  de tocar la base de datos.
- Paginación: parámetros `pagina` (base 1) y `limite`/`noticias_por_pagina`
  desde `configuracion`.
- Módulos backend con `require`/`module.exports` (CommonJS), consistente
  con `rss-parser`, `node-cron`, `better-sqlite3` o `sqlite3` (a elección
  del Subagente A, pero consistente en todo el proyecto).
- El frontend público y el panel admin son HTML/CSS/JS vanilla, sin build
  step, servidos directamente como estáticos por Express.
