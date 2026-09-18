'use strict';

/**
 * Migraciones y seed inicial de la base de datos.
 *
 * ============================================================================
 * CREDENCIALES INICIALES DEL PANEL DE ADMINISTRACIÓN (solo se crean si la
 * tabla "usuarios" está vacía, nunca se sobreescriben en corridas futuras):
 *
 *   usuario:  admin
 *   password: seguridad2024
 *
 * ¡IMPORTANTE! Esta contraseña es solo para el primer ingreso. Cambiarla
 * inmediatamente desde el panel de administración (PUT /api/admin/password)
 * apenas se despliegue el sitio en producción.
 * ============================================================================
 */

const bcrypt = require('bcrypt');
const db = require('./db');
const FUENTES_SEMILLA = require('../seeds/fuentes');

const RONDAS_BCRYPT = 10;

// Sentencias DDL, una por statement (better-sqlite3 solo puede preparar
// una sentencia SQL a la vez).
const SENTENCIAS_TABLAS = [
  `CREATE TABLE IF NOT EXISTS noticias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    resumen TEXT NOT NULL,
    contenido_propio TEXT,
    imagen_url TEXT,
    link_original TEXT NOT NULL,
    fecha_publicacion TEXT NOT NULL,
    fuente_id INTEGER,
    fuente_nombre TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'General',
    destacada INTEGER NOT NULL DEFAULT 0,
    oculta INTEGER NOT NULL DEFAULT 0,
    es_propia INTEGER NOT NULL DEFAULT 0,
    vistas INTEGER NOT NULL DEFAULT 0,
    creada_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (fuente_id) REFERENCES fuentes(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_noticias_link ON noticias(link_original)`,
  `CREATE INDEX IF NOT EXISTS idx_noticias_fecha ON noticias(fecha_publicacion)`,
  `CREATE INDEX IF NOT EXISTS idx_noticias_categoria ON noticias(categoria)`,

  `CREATE TABLE IF NOT EXISTS fuentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    url_rss TEXT NOT NULL UNIQUE,
    sitio_web TEXT,
    activa INTEGER NOT NULL DEFAULT 1,
    ultima_lectura TEXT,
    ultimo_error TEXT,
    total_noticias INTEGER NOT NULL DEFAULT 0,
    creada_en TEXT NOT NULL DEFAULT (datetime('now')),
    categoria_default TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS publicidades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    imagen_url TEXT NOT NULL,
    link_destino TEXT NOT NULL,
    posicion TEXT NOT NULL,
    activa INTEGER NOT NULL DEFAULT 1,
    impresiones INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    fecha_inicio TEXT,
    fecha_fin TEXT,
    creada_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    detalle TEXT,
    fecha TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'admin',
    ultimo_acceso TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS suscriptores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    confirmado INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    confirmado_en TEXT
  )`,
];

// Valores por defecto de la tabla "configuracion" (CONTRATO.md, sección 1).
const CONFIGURACION_POR_DEFECTO = {
  nombre_portal: 'La Huella',
  logo_url: '',
  color_primario: '#1a237e',
  color_acento: '#c62828',
  intervalo_rss_minutos: '30',
  noticias_por_pagina: '20',
  texto_legal_footer:
    'Este sitio agrega noticias de terceros con fines informativos. ' +
    'Cada tarjeta enlaza a la fuente original. No se reproduce el ' +
    'contenido completo de las notas.',
};

function crearTablas() {
  for (const sentencia of SENTENCIAS_TABLAS) {
    db.ejecutar(sentencia);
  }
}

/**
 * Agrega una columna a una tabla ya existente si todavía no la tiene.
 * `CREATE TABLE IF NOT EXISTS` no le agrega columnas nuevas a una tabla
 * que ya existía de antes (solo la crea si no existía), así que las
 * columnas que se suman después de la primera versión del esquema
 * necesitan este paso aparte. `tabla`/`columna`/`definicion` siempre son
 * literales fijos del propio código (nunca datos de entrada), así que
 * interpolarlos acá es seguro.
 */
function agregarColumnaSiFalta(tabla, columna, definicion) {
  const columnas = db.consultar(`PRAGMA table_info(${tabla})`);
  const yaExiste = columnas.some((c) => c.name === columna);
  if (!yaExiste) {
    db.ejecutar(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}

function sembrarUsuarioAdmin() {
  const existente = db.consultarUno('SELECT id FROM usuarios WHERE usuario = ?', ['admin']);
  if (existente) return;

  const hash = bcrypt.hashSync('seguridad2024', RONDAS_BCRYPT);
  db.ejecutar(
    'INSERT INTO usuarios (usuario, password_hash, rol) VALUES (?, ?, ?)',
    ['admin', hash, 'admin']
  );
  console.log(
    'Usuario administrador inicial creado (usuario: admin, contraseña: ' +
      'seguridad2024). Cambiarla apenas se pueda desde el panel de admin.'
  );
}

function sembrarConfiguracion() {
  const insertarSiNoExiste = (clave, valor) => {
    const existente = db.consultarUno('SELECT clave FROM configuracion WHERE clave = ?', [clave]);
    if (existente) return;
    db.ejecutar('INSERT INTO configuracion (clave, valor) VALUES (?, ?)', [clave, valor]);
  };

  for (const [clave, valor] of Object.entries(CONFIGURACION_POR_DEFECTO)) {
    insertarSiNoExiste(clave, valor);
  }
}

/**
 * Inserta las fuentes de seeds/fuentes.js que todavía no existan en la
 * tabla "fuentes" (comparando por `url_rss`, que es UNIQUE). Es
 * aditivo e idempotente: se puede llamar en cada arranque, y cada vez
 * que se agreguen fuentes nuevas a seeds/fuentes.js y se vuelva a
 * desplegar, esas nuevas se insertan solas sin tocar ni duplicar las
 * que ya estaban (incluidas las que el administrador ya activó o editó
 * a mano desde el panel).
 */
function sembrarFuentes() {
  let insertadas = 0;
  for (const fuente of FUENTES_SEMILLA) {
    const resultado = db.ejecutar(
      'INSERT OR IGNORE INTO fuentes (nombre, url_rss, sitio_web, activa) VALUES (?, ?, ?, ?)',
      [fuente.nombre, fuente.url_rss, fuente.sitio_web || null, fuente.activa ? 1 : 0]
    );
    if (resultado.changes > 0) insertadas += 1;
  }
  if (insertadas > 0) {
    console.log(`${insertadas} fuente(s) RSS nueva(s) de seeds/fuentes.js cargada(s).`);
  }
}

/**
 * La categoría "Detenciones" se eliminó (se fusionó en "Policía
 * Bonaerense"). Reasigna cualquier noticia ya guardada con esa
 * categoría vieja para que no quede "huérfana" (invisible desde el
 * filtro de categorías del portal, ya que esa categoría ya no aparece
 * en la lista).
 */
function reasignarCategoriaDetenciones() {
  db.ejecutar("UPDATE noticias SET categoria = 'Policía Bonaerense' WHERE categoria = 'Detenciones'");
}

/**
 * Renombra el portal de "Seguridad Bonaerense" (nombre original del
 * proyecto) a "La Huella" en instalaciones que ya venían corriendo desde
 * antes de este cambio. Solo actualiza si el valor sigue siendo
 * exactamente el default viejo, para no pisar un nombre que el
 * administrador ya haya personalizado a mano desde el panel.
 */
function renombrarPortalSiSigueEnValorViejo() {
  db.ejecutar(
    "UPDATE configuracion SET valor = 'La Huella' WHERE clave = 'nombre_portal' AND valor = 'Seguridad Bonaerense'"
  );
}

/**
 * Crea todas las tablas (si no existen) e inserta los datos semilla
 * (usuario admin, configuración por defecto y fuentes RSS candidatas)
 * si todavía no existen. Es seguro llamarla en cada arranque del
 * servidor: es idempotente.
 */
function ejecutarMigraciones() {
  crearTablas();
  agregarColumnaSiFalta('fuentes', 'categoria_default', 'TEXT');
  sembrarUsuarioAdmin();
  sembrarConfiguracion();
  sembrarFuentes();
  renombrarPortalSiSigueEnValorViejo();
  reasignarCategoriaDetenciones();
}

module.exports = { ejecutarMigraciones };
