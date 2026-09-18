'use strict';

/**
 * Motor de lectura de feeds RSS.
 *
 * Lee las fuentes configuradas, extrae de cada item solo los datos que la
 * política legal del portal permite guardar (nunca el cuerpo completo de
 * la nota: título, resumen recortado, imagen, link, fecha, fuente y
 * categoría), categoriza cada noticia y la guarda evitando duplicados por
 * `link_original`.
 *
 * Aislamiento de fallas: si una fuente puntual falla (timeout, XML
 * inválido, DNS caído, etc.) el error se registra en `fuentes.ultimo_error`
 * y en la tabla `logs`, pero el resto de las fuentes se sigue procesando
 * con normalidad.
 *
 * Contrato exacto (ver CONTRATO.md, sección 4bis):
 *   actualizarTodas()          -> { fuentesLeidas, noticiasNuevas, errores: [{fuente, error}] }
 *   actualizarFuente(fuenteId) -> { noticiasNuevas, error }
 *   validarFeed(urlRss)        -> { valido, titulos } | { valido: false, mensaje }
 */

const Parser = require('rss-parser');
const db = require('../database/db');
const categorizador = require('./categorizador');

// Identificación del bot en las peticiones HTTP, para que los medios que
// leemos puedan reconocer de dónde viene el tráfico.
const USER_AGENT = 'SeguridadBonaerense-RSS-Bot/1.0 (+https://seguridadbonaerense.example)';

// Timeout al leer un feed para guardar noticias (proceso de fondo, puede
// tolerar un poco más de espera).
const TIMEOUT_LECTURA_MS = 15000;

// Timeout al validar un feed desde el panel admin (el usuario está
// esperando una respuesta interactiva, tiene que ser corto).
const TIMEOUT_VALIDACION_MS = 7000;

// Longitud máxima del resumen guardado, en caracteres.
const MAX_LARGO_RESUMEN = 300;

// Campos de espacio de nombres "media" (media:content / media:thumbnail)
// que rss-parser no interpreta por defecto: hay que pedirlos explícitamente
// como "customFields" para poder usarlos como fuente de imagen.
const OPCIONES_CUSTOM_FIELDS = {
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
    ],
  },
};

// Parser usado para la lectura real (timeout largo).
const parserLectura = new Parser({
  timeout: TIMEOUT_LECTURA_MS,
  headers: { 'User-Agent': USER_AGENT },
  ...OPCIONES_CUSTOM_FIELDS,
});

// Parser separado usado solo para validar feeds desde el panel admin
// (timeout corto, no comparte estado con el de lectura).
const parserValidacion = new Parser({
  timeout: TIMEOUT_VALIDACION_MS,
  headers: { 'User-Agent': USER_AGENT },
  ...OPCIONES_CUSTOM_FIELDS,
});

/**
 * Devuelve el mensaje de error legible de una excepción cualquiera.
 * @param {*} err
 * @returns {string}
 */
function mensajeDeError(err) {
  if (!err) return 'Error desconocido';
  if (err.message) return err.message;
  return String(err);
}

/**
 * Reemplaza entidades HTML comunes por su carácter equivalente. No
 * pretende ser un decodificador completo, solo cubrir los casos típicos
 * que aparecen en descripciones de feeds RSS.
 * @param {string} texto
 * @returns {string}
 */
function decodificarEntidadesHtml(texto) {
  return texto
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

/**
 * Quita cualquier etiqueta HTML (`<...>`) de un texto.
 * @param {string} texto
 * @returns {string}
 */
function quitarHtml(texto) {
  if (!texto) return '';
  return String(texto).replace(/<[^>]*>/g, '');
}

/**
 * Limpia un texto simple (título): quita HTML, decodifica entidades y
 * colapsa espacios en blanco repetidos.
 * @param {string} texto
 * @returns {string}
 */
function limpiarTexto(texto) {
  if (!texto) return '';
  return decodificarEntidadesHtml(quitarHtml(String(texto)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Arma el resumen de una noticia a partir de los campos de texto
 * disponibles en el item del feed: quita HTML, decodifica entidades,
 * colapsa espacios y recorta a un máximo de 300 caracteres.
 * @param {Object} item - item del feed ya parseado por rss-parser.
 * @returns {string}
 */
function extraerResumen(item) {
  const crudo =
    item.contentSnippet ||
    item.summary ||
    item.description ||
    item['content:encoded'] ||
    item.content ||
    '';
  const sinHtml = quitarHtml(crudo);
  const decodificado = decodificarEntidadesHtml(sinHtml);
  const limpio = decodificado.replace(/\s+/g, ' ').trim();
  return limpio.slice(0, MAX_LARGO_RESUMEN);
}

/**
 * Extrae una URL de un campo tipo media:content / media:thumbnail, que
 * rss-parser entrega como objeto (con atributos bajo `$`) o como array de
 * objetos cuando hay más de una ocurrencia (por `keepArray: true`).
 * @param {*} campo
 * @returns {string|null}
 */
function extraerUrlDeCampoMedia(campo) {
  if (!campo) return null;
  const valor = Array.isArray(campo) ? campo[0] : campo;
  if (!valor) return null;
  if (typeof valor === 'string') return valor;
  if (valor.$ && valor.$.url) return valor.$.url;
  if (valor.url) return valor.url;
  return null;
}

/**
 * Busca la imagen de una noticia siguiendo el orden de prioridad pedido:
 * enclosure.url -> media:content -> media:thumbnail -> primer <img src="">
 * dentro del contenido/descripción -> null si no se encuentra nada.
 * @param {Object} item
 * @returns {string|null}
 */
function extraerImagen(item) {
  if (item.enclosure && item.enclosure.url) {
    return item.enclosure.url;
  }

  const mediaContent = extraerUrlDeCampoMedia(item.mediaContent);
  if (mediaContent) return mediaContent;

  const mediaThumbnail = extraerUrlDeCampoMedia(item.mediaThumbnail);
  if (mediaThumbnail) return mediaThumbnail;

  const html =
    item['content:encoded'] || item.content || item.summary || item.description || '';
  const coincidencia = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (coincidencia) return coincidencia[1];

  return null;
}

/**
 * Devuelve la fecha de publicación de un item en formato ISO 8601. Si el
 * feed no trae una fecha parseable, devuelve la fecha/hora actual.
 * @param {Object} item
 * @returns {string}
 */
function extraerFecha(item) {
  const candidatos = [item.isoDate, item.pubDate];
  for (const candidato of candidatos) {
    if (!candidato) continue;
    const fecha = new Date(candidato);
    if (!Number.isNaN(fecha.getTime())) {
      return fecha.toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Devuelve el link original de un item, o null si el item no trae uno
 * utilizable (en ese caso no se puede deduplicar ni mostrar la noticia).
 * @param {Object} item
 * @returns {string|null}
 */
function obtenerLink(item) {
  if (item.link && typeof item.link === 'string' && item.link.trim()) {
    return item.link.trim();
  }
  if (item.guid && typeof item.guid === 'string' && /^https?:\/\//i.test(item.guid)) {
    return item.guid.trim();
  }
  return null;
}

/**
 * Procesa un item individual de un feed: si no existe ya una noticia con
 * el mismo link_original, lo categoriza y lo inserta en la base. Nunca
 * guarda el cuerpo completo de la nota (regla legal del portal): solo
 * título, resumen recortado, imagen, link, fecha, fuente y categoría.
 *
 * @param {Object} item - item ya parseado por rss-parser.
 * @param {Object} fuente - fila de la tabla `fuentes` (id, nombre, ...).
 * @returns {boolean} true si se insertó una noticia nueva, false si se
 *   descartó (sin link válido o ya existente).
 */
function procesarItem(item, fuente) {
  const link = obtenerLink(item);
  if (!link) return false;

  const existente = db.consultarUno('SELECT id FROM noticias WHERE link_original = ?', [link]);
  if (existente) return false;

  const titulo = limpiarTexto(item.title) || '(sin título)';
  const resumen = extraerResumen(item);
  const imagenUrl = extraerImagen(item);
  const fechaPublicacion = extraerFecha(item);
  const categoria = categorizador.categorizar(titulo, resumen);

  db.ejecutar(
    `INSERT INTO noticias
       (titulo, resumen, contenido_propio, imagen_url, link_original, fecha_publicacion, fuente_id, fuente_nombre, categoria, es_propia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [titulo, resumen, null, imagenUrl, link, fechaPublicacion, fuente.id, fuente.nombre, categoria]
  );

  return true;
}

/**
 * Procesa una fuente completa: lee su feed, guarda las noticias nuevas,
 * actualiza sus metadatos (`ultima_lectura`, `total_noticias`,
 * `ultimo_error`) y registra el resultado en `logs`. Nunca lanza una
 * excepción hacia afuera: cualquier error queda capturado y reflejado en
 * el resultado devuelto, para no frenar el procesamiento del resto de las
 * fuentes.
 *
 * @param {Object} fuente - fila de la tabla `fuentes`.
 * @returns {Promise<{noticiasNuevas: number, error: string|null}>}
 */
async function procesarFuente(fuente) {
  let feed;
  try {
    feed = await parserLectura.parseURL(fuente.url_rss);
  } catch (err) {
    const mensaje = mensajeDeError(err);
    try {
      db.ejecutar(
        "UPDATE fuentes SET ultimo_error = ?, ultima_lectura = datetime('now') WHERE id = ?",
        [mensaje, fuente.id]
      );
      db.ejecutar(
        "INSERT INTO logs (tipo, mensaje, detalle, fecha) VALUES (?, ?, ?, datetime('now'))",
        ['error', `Error al leer la fuente "${fuente.nombre}"`, mensaje]
      );
    } catch (errRegistro) {
      // Un fallo al registrar el error en la base no debe ocultar el
      // error original ni frenar el resto del proceso.
      console.error('[rssService] No se pudo registrar el error en la base:', mensajeDeError(errRegistro));
    }
    return { noticiasNuevas: 0, error: mensaje };
  }

  let noticiasNuevas = 0;
  const items = Array.isArray(feed.items) ? feed.items : [];

  for (const item of items) {
    try {
      if (procesarItem(item, fuente)) {
        noticiasNuevas += 1;
      }
    } catch (errItem) {
      // Un item individual mal formado no debe frenar el resto del feed.
      console.error(
        `[rssService] Se descartó un item de "${fuente.nombre}" por un error al procesarlo:`,
        mensajeDeError(errItem)
      );
    }
  }

  try {
    db.ejecutar(
      "UPDATE fuentes SET ultima_lectura = datetime('now'), total_noticias = total_noticias + ?, ultimo_error = NULL WHERE id = ?",
      [noticiasNuevas, fuente.id]
    );
    db.ejecutar(
      "INSERT INTO logs (tipo, mensaje, detalle, fecha) VALUES (?, ?, ?, datetime('now'))",
      [
        'rss',
        `Fuente "${fuente.nombre}" procesada correctamente`,
        `${noticiasNuevas} noticia(s) nueva(s) de ${items.length} ítem(s) leído(s)`,
      ]
    );
  } catch (errRegistro) {
    console.error('[rssService] No se pudo registrar el resultado en la base:', mensajeDeError(errRegistro));
  }

  return { noticiasNuevas, error: null };
}

/**
 * Lee todas las fuentes activas y guarda las noticias nuevas de cada una.
 * Si una fuente falla no se frena el resto: el error queda aislado en el
 * array `errores` del resultado.
 * @returns {Promise<{fuentesLeidas: number, noticiasNuevas: number, errores: Array<{fuente: string, error: string}>}>}
 */
async function actualizarTodas() {
  let fuentes;
  try {
    fuentes = db.consultar('SELECT * FROM fuentes WHERE activa = 1');
  } catch (err) {
    console.error('[rssService] No se pudieron leer las fuentes activas:', mensajeDeError(err));
    return { fuentesLeidas: 0, noticiasNuevas: 0, errores: [{ fuente: '(todas)', error: mensajeDeError(err) }] };
  }

  let fuentesLeidas = 0;
  let noticiasNuevas = 0;
  const errores = [];

  for (const fuente of fuentes) {
    const resultado = await procesarFuente(fuente);
    fuentesLeidas += 1;
    noticiasNuevas += resultado.noticiasNuevas;
    if (resultado.error) {
      errores.push({ fuente: fuente.nombre, error: resultado.error });
    }
  }

  return { fuentesLeidas, noticiasNuevas, errores };
}

/**
 * Lee y procesa una única fuente por id.
 * @param {number} fuenteId
 * @returns {Promise<{noticiasNuevas: number, error: string|null}>}
 */
async function actualizarFuente(fuenteId) {
  let fuente;
  try {
    fuente = db.consultarUno('SELECT * FROM fuentes WHERE id = ?', [fuenteId]);
  } catch (err) {
    return { noticiasNuevas: 0, error: mensajeDeError(err) };
  }

  if (!fuente) {
    return { noticiasNuevas: 0, error: 'No existe una fuente con ese id.' };
  }

  return procesarFuente(fuente);
}

/**
 * Intenta parsear un feed RSS para validar que sea accesible y bien
 * formado, sin guardar nada en la base. Usa un timeout corto porque
 * normalmente se llama desde una petición interactiva del panel admin.
 * Nunca lanza una excepción: ante cualquier fallo devuelve
 * `{ valido: false, mensaje }`.
 *
 * @param {string} urlRss
 * @returns {Promise<{valido: true, titulos: string[]} | {valido: false, mensaje: string}>}
 */
async function validarFeed(urlRss) {
  if (!urlRss || typeof urlRss !== 'string' || !urlRss.trim()) {
    return { valido: false, mensaje: 'La URL del feed no puede estar vacía.' };
  }

  try {
    const feed = await parserValidacion.parseURL(urlRss.trim());
    const items = Array.isArray(feed.items) ? feed.items : [];
    const titulos = items.slice(0, 3).map((item) => limpiarTexto(item.title) || '(sin título)');
    return { valido: true, titulos };
  } catch (err) {
    return { valido: false, mensaje: mensajeDeError(err) };
  }
}

module.exports = {
  actualizarTodas,
  actualizarFuente,
  validarFeed,
};
