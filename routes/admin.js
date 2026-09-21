'use strict';

/**
 * Rutas de administración (requieren `Authorization: Bearer <token>`) —
 * CONTRATO.md, sección 2.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const db = require('../database/db');
const { verificarToken, generarToken } = require('../middleware/auth');
const { asyncHandler, CodigoError } = require('../middleware/errores');

const router = express.Router();

const CATEGORIAS_POR_DEFECTO = ['Policial', 'Político', 'Deportivo', 'General'];

const POSICIONES_PUBLICIDAD = ['header', 'sidebar', 'entre-noticias', 'footer', 'destacada'];

const CLAVES_CONFIGURACION_VALIDAS = [
  'nombre_portal',
  'logo_url',
  'color_primario',
  'color_acento',
  'color_fondo',
  'tamano_fuente_base',
  'intervalo_rss_minutos',
  'noticias_por_pagina',
  'texto_legal_footer',
];

// Tamaños de letra permitidos (px), aplicados como font-size del <html>
// del portal público: como el resto del CSS está en unidades rem, esto
// escala proporcionalmente todo el sitio de una sola vez.
const TAMANOS_FUENTE_VALIDOS = ['14', '16', '18', '20'];

// ---------------------------------------------------------------------------
// Helpers de validación / sanitización
// ---------------------------------------------------------------------------

function obtenerCategorias() {
  try {
    // eslint-disable-next-line global-require
    const categorizador = require('../services/categorizador');
    if (Array.isArray(categorizador.CATEGORIAS) && categorizador.CATEGORIAS.length > 0) {
      return categorizador.CATEGORIAS;
    }
    return CATEGORIAS_POR_DEFECTO;
  } catch (err) {
    return CATEGORIAS_POR_DEFECTO;
  }
}

function quitarHtml(texto) {
  return texto.replace(/<[^>]*>/g, '').trim();
}

function requerirString(valor, nombreCampo, { maxLength = 1000, minLength = 1, quitarEtiquetas = false } = {}) {
  if (typeof valor !== 'string') {
    throw new CodigoError(`El campo "${nombreCampo}" es requerido.`, 400);
  }
  const limpio = quitarEtiquetas ? quitarHtml(valor) : valor.trim();
  if (limpio.length < minLength) {
    throw new CodigoError(`El campo "${nombreCampo}" es requerido.`, 400);
  }
  if (limpio.length > maxLength) {
    throw new CodigoError(`El campo "${nombreCampo}" no puede superar los ${maxLength} caracteres.`, 400);
  }
  return limpio;
}

function opcionalString(valor, nombreCampo, { maxLength = 1000, quitarEtiquetas = false } = {}) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string') {
    throw new CodigoError(`El campo "${nombreCampo}" debe ser de tipo texto.`, 400);
  }
  const limpio = quitarEtiquetas ? quitarHtml(valor) : valor.trim();
  if (limpio.length > maxLength) {
    throw new CodigoError(`El campo "${nombreCampo}" no puede superar los ${maxLength} caracteres.`, 400);
  }
  return limpio;
}

function esUrlValida(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function requerirUrl(valor, nombreCampo, { maxLength = 500 } = {}) {
  const limpio = requerirString(valor, nombreCampo, { maxLength });
  if (!esUrlValida(limpio)) {
    throw new CodigoError(`El campo "${nombreCampo}" debe ser una URL http(s) válida.`, 400);
  }
  return limpio;
}

function opcionalUrl(valor, nombreCampo, { maxLength = 500 } = {}) {
  const limpio = opcionalString(valor, nombreCampo, { maxLength });
  if (limpio === undefined) return undefined;
  if (!esUrlValida(limpio)) {
    throw new CodigoError(`El campo "${nombreCampo}" debe ser una URL http(s) válida.`, 400);
  }
  return limpio;
}

function validarCategoriaDefaultOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const categorias = obtenerCategorias();
  if (typeof valor !== 'string' || !categorias.includes(valor)) {
    throw new CodigoError(
      `La categoría fija de la fuente debe ser una de: ${categorias.join(', ')}, o vacío para automático.`,
      400
    );
  }
  return valor;
}

function validarCategoria(valor) {
  if (valor === undefined || valor === null || valor === '') return 'General';
  const categorias = obtenerCategorias();
  if (typeof valor !== 'string' || !categorias.includes(valor)) {
    throw new CodigoError(`La categoría debe ser una de: ${categorias.join(', ')}.`, 400);
  }
  return valor;
}

function validarFechaISO(valor, nombreCampo) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) {
    throw new CodigoError(`El campo "${nombreCampo}" debe ser una fecha válida (ISO 8601).`, 400);
  }
  return valor;
}

function aEnteroPositivo(valor) {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function aBooleanoDB(valor) {
  return valor ? 1 : 0;
}

/**
 * Valida un monto monetario opcional (ej. `monto_mensual` de una
 * publicidad): número finito >= 0, o null/undefined/'' para "sin dato".
 * Es solo un registro informativo del panel (para que el administrador
 * sepa cuánto le factura a cada anunciante), no cobra ni procesa ningún
 * pago real.
 */
function aMontoOpcional(valor, nombreCampo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    throw new CodigoError(`El campo "${nombreCampo}" debe ser un número mayor o igual a 0.`, 400);
  }
  return n;
}

function esConstraintUnico(err) {
  return Boolean(err && typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed'));
}

function esConstraintForanea(err) {
  return Boolean(err && typeof err.message === 'string' && err.message.includes('FOREIGN KEY constraint failed'));
}

function obtenerNoticiaOFallar(id) {
  const fila = db.consultarUno('SELECT * FROM noticias WHERE id = ?', [id]);
  if (!fila) {
    throw new CodigoError('La noticia solicitada no existe.', 404);
  }
  return fila;
}

function mapearNoticiaAdmin(fila) {
  return {
    id: fila.id,
    titulo: fila.titulo,
    resumen: fila.resumen,
    contenido_propio: fila.contenido_propio,
    imagen_url: fila.imagen_url,
    link_original: fila.link_original,
    fecha_publicacion: fila.fecha_publicacion,
    fuente_id: fila.fuente_id,
    fuente_nombre: fila.fuente_nombre,
    categoria: fila.categoria,
    destacada: Boolean(fila.destacada),
    oculta: Boolean(fila.oculta),
    es_propia: Boolean(fila.es_propia),
    vistas: fila.vistas,
    creada_en: fila.creada_en,
  };
}

// ---------------------------------------------------------------------------
// POST /api/admin/login (con rate limiting: 5 intentos / 15 min / IP)
// ---------------------------------------------------------------------------

const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: true,
      mensaje: 'Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a intentar.',
      codigo: 429,
    });
  },
});

router.post(
  '/login',
  limitadorLogin,
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    if (typeof cuerpo.usuario !== 'string' || !cuerpo.usuario.trim()) {
      throw new CodigoError('El usuario es requerido.', 400);
    }
    if (typeof cuerpo.password !== 'string' || !cuerpo.password) {
      throw new CodigoError('La contraseña es requerida.', 400);
    }

    const usuario = cuerpo.usuario.trim();
    const fila = db.consultarUno('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);

    if (!fila || !bcrypt.compareSync(cuerpo.password, fila.password_hash)) {
      return res.status(401).json({
        error: true,
        mensaje: 'Usuario o contraseña incorrectos.',
        codigo: 401,
      });
    }

    db.ejecutar("UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?", [fila.id]);

    const token = generarToken(fila.usuario);
    res.json({ token, usuario: fila.usuario });
  })
);

// A partir de acá, todas las rutas requieren token válido.
router.use(verificarToken);

// GET /api/admin/verificar
router.get(
  '/verificar',
  asyncHandler(async (req, res) => {
    res.json({ valido: true, usuario: req.usuario });
  })
);

// GET /api/admin/stats
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const porDia = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const fecha = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const filaCantidad = db.consultarUno(
        "SELECT COUNT(*) AS cantidad FROM noticias WHERE date(fecha_publicacion) = ?",
        [fecha]
      );
      porDia.push({ fecha, cantidad: filaCantidad ? filaCantidad.cantidad : 0 });
    }

    const hoy = porDia[porDia.length - 1].cantidad;
    const semana = porDia.reduce((acc, dia) => acc + dia.cantidad, 0);
    const total = db.consultarUno('SELECT COUNT(*) AS total FROM noticias').total;
    const fuentesActivas = db.consultarUno('SELECT COUNT(*) AS total FROM fuentes WHERE activa = 1').total;
    const ultimaLecturaFila = db.consultarUno('SELECT MAX(ultima_lectura) AS m FROM fuentes');
    const ultimoLogRss = db.consultarUno(
      "SELECT mensaje FROM logs WHERE tipo = 'rss' ORDER BY datetime(fecha) DESC LIMIT 1"
    );
    const suscriptoresActivos = db.consultarUno(
      'SELECT COUNT(*) AS total FROM suscriptores WHERE confirmado = 1 AND activo = 1'
    ).total;

    res.json({
      hoy,
      semana,
      total,
      fuentesActivas,
      suscriptoresActivos,
      ultimaLecturaRss: ultimaLecturaFila ? ultimaLecturaFila.m : null,
      ultimoResultadoRss: ultimoLogRss ? ultimoLogRss.mensaje : null,
      porDia,
    });
  })
);

// GET /api/admin/noticias?pagina=&buscar=&categoria=&fuente=
router.get(
  '/noticias',
  asyncHandler(async (req, res) => {
    const pagina = aEnteroPositivo(req.query.pagina) || 1;
    const limiteFila = db.consultarUno('SELECT valor FROM configuracion WHERE clave = ?', [
      'noticias_por_pagina',
    ]);
    const limitePorDefecto = limiteFila && Number.isInteger(parseInt(limiteFila.valor, 10))
      ? parseInt(limiteFila.valor, 10)
      : 20;
    const limiteQuery = aEnteroPositivo(req.query.limite);
    const limite = limiteQuery ? Math.min(limiteQuery, 100) : limitePorDefecto;

    const condiciones = [];
    const parametros = [];

    const buscar = typeof req.query.buscar === 'string' ? req.query.buscar.trim() : '';
    if (buscar) {
      condiciones.push('(titulo LIKE ? OR resumen LIKE ?)');
      const patron = `%${buscar.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      parametros.push(patron, patron);
    }

    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '';
    if (categoria) {
      condiciones.push('categoria = ?');
      parametros.push(categoria);
    }

    const fuente = typeof req.query.fuente === 'string' ? req.query.fuente.trim() : '';
    if (fuente) {
      const fuenteId = aEnteroPositivo(fuente);
      if (fuenteId) {
        condiciones.push('fuente_id = ?');
        parametros.push(fuenteId);
      } else {
        condiciones.push('fuente_nombre LIKE ?');
        parametros.push(`%${fuente}%`);
      }
    }

    const whereSql = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const filaTotal = db.consultarUno(`SELECT COUNT(*) AS total FROM noticias ${whereSql}`, parametros);
    const total = filaTotal ? filaTotal.total : 0;
    const totalPaginas = total > 0 ? Math.ceil(total / limite) : 0;
    const offset = (pagina - 1) * limite;

    const filas = db.consultar(
      `SELECT * FROM noticias ${whereSql} ORDER BY datetime(fecha_publicacion) DESC LIMIT ? OFFSET ?`,
      [...parametros, limite, offset]
    );

    res.json({
      noticias: filas.map(mapearNoticiaAdmin),
      total,
      pagina,
      totalPaginas,
    });
  })
);

// POST /api/admin/noticias (crea noticia propia)
router.post(
  '/noticias',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};

    const titulo = requerirString(cuerpo.titulo, 'titulo', { maxLength: 300 });
    const resumen = requerirString(cuerpo.resumen, 'resumen', { maxLength: 300, quitarEtiquetas: true });
    const contenidoPropio = requerirString(cuerpo.contenido_propio, 'contenido_propio', {
      maxLength: 50000,
      quitarEtiquetas: false,
    });
    const imagenUrl = opcionalUrl(cuerpo.imagen_url, 'imagen_url') || null;
    const categoria = validarCategoria(cuerpo.categoria);
    const fechaPublicacion = validarFechaISO(cuerpo.fecha_publicacion, 'fecha_publicacion')
      || new Date().toISOString();
    const linkOriginalManual = opcionalString(cuerpo.link_original, 'link_original', { maxLength: 500 });

    const configPortal = db.consultarUno('SELECT valor FROM configuracion WHERE clave = ?', [
      'nombre_portal',
    ]);
    const fuenteNombre = (configPortal && configPortal.valor) || 'El Observador';

    // link_original es NOT NULL + UNIQUE. Para una noticia propia se usa
    // un placeholder temporal único y después se fija a "/noticia/<id>".
    const placeholderTemporal = `pendiente:propia:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    let resultado;
    try {
      resultado = db.ejecutar(
        `INSERT INTO noticias
           (titulo, resumen, contenido_propio, imagen_url, link_original, fecha_publicacion,
            fuente_id, fuente_nombre, categoria, destacada, oculta, es_propia, vistas)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 1, 0)`,
        [
          titulo,
          resumen,
          contenidoPropio,
          imagenUrl,
          linkOriginalManual || placeholderTemporal,
          fechaPublicacion,
          fuenteNombre,
          categoria,
        ]
      );
    } catch (err) {
      if (esConstraintUnico(err)) {
        throw new CodigoError('Ya existe una noticia con ese link_original.', 400);
      }
      throw err;
    }

    const id = resultado.lastInsertRowid;

    if (!linkOriginalManual) {
      db.ejecutar('UPDATE noticias SET link_original = ? WHERE id = ?', [`/noticia/${id}`, id]);
    }

    const fila = obtenerNoticiaOFallar(id);
    res.status(201).json(mapearNoticiaAdmin(fila));
  })
);

// PUT /api/admin/noticias/:id (edita)
router.put(
  '/noticias/:id',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la noticia no es válido.', 400);

    obtenerNoticiaOFallar(id);
    const cuerpo = req.body || {};

    const campos = [];
    const valores = [];

    if (cuerpo.titulo !== undefined) {
      campos.push('titulo = ?');
      valores.push(requerirString(cuerpo.titulo, 'titulo', { maxLength: 300 }));
    }
    if (cuerpo.resumen !== undefined) {
      campos.push('resumen = ?');
      valores.push(requerirString(cuerpo.resumen, 'resumen', { maxLength: 300, quitarEtiquetas: true }));
    }
    if (cuerpo.contenido_propio !== undefined) {
      campos.push('contenido_propio = ?');
      valores.push(
        cuerpo.contenido_propio === null
          ? null
          : requerirString(cuerpo.contenido_propio, 'contenido_propio', { maxLength: 50000 })
      );
    }
    if (cuerpo.imagen_url !== undefined) {
      campos.push('imagen_url = ?');
      valores.push(cuerpo.imagen_url === null ? null : opcionalUrl(cuerpo.imagen_url, 'imagen_url') || null);
    }
    if (cuerpo.link_original !== undefined) {
      campos.push('link_original = ?');
      valores.push(requerirString(cuerpo.link_original, 'link_original', { maxLength: 500 }));
    }
    if (cuerpo.fecha_publicacion !== undefined) {
      campos.push('fecha_publicacion = ?');
      valores.push(validarFechaISO(cuerpo.fecha_publicacion, 'fecha_publicacion'));
    }
    if (cuerpo.categoria !== undefined) {
      campos.push('categoria = ?');
      valores.push(validarCategoria(cuerpo.categoria));
    }
    if (cuerpo.destacada !== undefined) {
      campos.push('destacada = ?');
      valores.push(aBooleanoDB(cuerpo.destacada));
    }
    if (cuerpo.oculta !== undefined) {
      campos.push('oculta = ?');
      valores.push(aBooleanoDB(cuerpo.oculta));
    }

    if (campos.length === 0) {
      throw new CodigoError('No se recibió ningún campo para actualizar.', 400);
    }

    try {
      db.ejecutar(`UPDATE noticias SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]);
    } catch (err) {
      if (esConstraintUnico(err)) {
        throw new CodigoError('Ya existe otra noticia con ese link_original.', 400);
      }
      throw err;
    }

    const fila = obtenerNoticiaOFallar(id);
    res.json(mapearNoticiaAdmin(fila));
  })
);

// DELETE /api/admin/noticias/:id
router.delete(
  '/noticias/:id',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la noticia no es válido.', 400);

    const resultado = db.ejecutar('DELETE FROM noticias WHERE id = ?', [id]);
    if (resultado.changes === 0) {
      throw new CodigoError('La noticia solicitada no existe.', 404);
    }

    res.json({ ok: true });
  })
);

// PATCH /api/admin/noticias/:id/destacar
const MAX_DESTACADAS = 3;

router.patch(
  '/noticias/:id/destacar',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la noticia no es válido.', 400);

    const fila = obtenerNoticiaOFallar(id);
    const nuevoValor = fila.destacada ? 0 : 1;

    if (nuevoValor === 1) {
      // Hasta MAX_DESTACADAS noticias pueden estar destacadas a la vez
      // (se muestran juntas en la portada). Si ya se llegó al máximo, se
      // desmarca la destacada más vieja (por fecha de publicación) para
      // hacerle lugar a la nueva.
      const marcadas = db.consultarUno('SELECT COUNT(*) AS total FROM noticias WHERE destacada = 1').total;
      if (marcadas >= MAX_DESTACADAS) {
        const masVieja = db.consultarUno(
          'SELECT id FROM noticias WHERE destacada = 1 ORDER BY datetime(fecha_publicacion) ASC LIMIT 1'
        );
        if (masVieja) {
          db.ejecutar('UPDATE noticias SET destacada = 0 WHERE id = ?', [masVieja.id]);
        }
      }
    }
    db.ejecutar('UPDATE noticias SET destacada = ? WHERE id = ?', [nuevoValor, id]);

    res.json({ id, destacada: Boolean(nuevoValor) });
  })
);

// PATCH /api/admin/noticias/:id/ocultar
router.patch(
  '/noticias/:id/ocultar',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la noticia no es válido.', 400);

    const fila = obtenerNoticiaOFallar(id);
    const nuevoValor = fila.oculta ? 0 : 1;
    db.ejecutar('UPDATE noticias SET oculta = ? WHERE id = ?', [nuevoValor, id]);

    res.json({ id, oculta: Boolean(nuevoValor) });
  })
);

// GET /api/admin/fuentes
router.get(
  '/fuentes',
  asyncHandler(async (req, res) => {
    const filas = db.consultar('SELECT * FROM fuentes ORDER BY nombre ASC');
    res.json(filas.map((f) => ({ ...f, activa: Boolean(f.activa) })));
  })
);

// POST /api/admin/fuentes
router.post(
  '/fuentes',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    const nombre = requerirString(cuerpo.nombre, 'nombre', { maxLength: 150 });
    const urlRss = requerirUrl(cuerpo.url_rss, 'url_rss', { maxLength: 500 });
    const sitioWeb = opcionalUrl(cuerpo.sitio_web, 'sitio_web') || null;
    const categoriaDefault = validarCategoriaDefaultOpcional(cuerpo.categoria_default);

    let resultado;
    try {
      resultado = db.ejecutar(
        'INSERT INTO fuentes (nombre, url_rss, sitio_web, activa, categoria_default) VALUES (?, ?, ?, 1, ?)',
        [nombre, urlRss, sitioWeb, categoriaDefault]
      );
    } catch (err) {
      if (esConstraintUnico(err)) {
        throw new CodigoError('Ya existe una fuente con esa URL de RSS.', 400);
      }
      throw err;
    }

    const fila = db.consultarUno('SELECT * FROM fuentes WHERE id = ?', [resultado.lastInsertRowid]);
    res.status(201).json({ ...fila, activa: Boolean(fila.activa) });
  })
);

// PUT /api/admin/fuentes/:id
router.put(
  '/fuentes/:id',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la fuente no es válido.', 400);

    const existente = db.consultarUno('SELECT * FROM fuentes WHERE id = ?', [id]);
    if (!existente) throw new CodigoError('La fuente solicitada no existe.', 404);

    const cuerpo = req.body || {};
    const campos = [];
    const valores = [];

    if (cuerpo.nombre !== undefined) {
      campos.push('nombre = ?');
      valores.push(requerirString(cuerpo.nombre, 'nombre', { maxLength: 150 }));
    }
    if (cuerpo.url_rss !== undefined) {
      campos.push('url_rss = ?');
      valores.push(requerirUrl(cuerpo.url_rss, 'url_rss', { maxLength: 500 }));
    }
    if (cuerpo.sitio_web !== undefined) {
      campos.push('sitio_web = ?');
      valores.push(cuerpo.sitio_web === null ? null : opcionalUrl(cuerpo.sitio_web, 'sitio_web') || null);
    }
    if (cuerpo.activa !== undefined) {
      campos.push('activa = ?');
      valores.push(aBooleanoDB(cuerpo.activa));
    }
    if (cuerpo.categoria_default !== undefined) {
      campos.push('categoria_default = ?');
      valores.push(validarCategoriaDefaultOpcional(cuerpo.categoria_default));
    }

    if (campos.length === 0) {
      throw new CodigoError('No se recibió ningún campo para actualizar.', 400);
    }

    try {
      db.ejecutar(`UPDATE fuentes SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]);
    } catch (err) {
      if (esConstraintUnico(err)) {
        throw new CodigoError('Ya existe otra fuente con esa URL de RSS.', 400);
      }
      throw err;
    }

    const fila = db.consultarUno('SELECT * FROM fuentes WHERE id = ?', [id]);
    res.json({ ...fila, activa: Boolean(fila.activa) });
  })
);

// DELETE /api/admin/fuentes/:id
router.delete(
  '/fuentes/:id',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la fuente no es válido.', 400);

    try {
      const resultado = db.ejecutar('DELETE FROM fuentes WHERE id = ?', [id]);
      if (resultado.changes === 0) {
        throw new CodigoError('La fuente solicitada no existe.', 404);
      }
    } catch (err) {
      if (err instanceof CodigoError) throw err;
      if (esConstraintForanea(err)) {
        throw new CodigoError(
          'No se puede eliminar la fuente porque tiene noticias asociadas.',
          400
        );
      }
      throw err;
    }

    res.json({ ok: true });
  })
);

// POST /api/admin/fuentes/validar
router.post(
  '/fuentes/validar',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    const urlRss = requerirUrl(cuerpo.url_rss, 'url_rss', { maxLength: 500 });

    let rssService;
    try {
      // eslint-disable-next-line global-require
      rssService = require('../services/rssService');
    } catch (err) {
      return res.json({
        valido: false,
        mensaje: 'El servicio de validación de feeds RSS no está disponible en este momento.',
      });
    }

    try {
      const resultado = await rssService.validarFeed(urlRss);
      res.json(resultado);
    } catch (err) {
      res.json({ valido: false, mensaje: `No se pudo validar el feed: ${err.message}` });
    }
  })
);

// POST /api/admin/rss/actualizar
router.post(
  '/rss/actualizar',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    let fuenteId;
    if (cuerpo.fuente_id !== undefined && cuerpo.fuente_id !== null) {
      fuenteId = aEnteroPositivo(cuerpo.fuente_id);
      if (!fuenteId) {
        throw new CodigoError('El campo "fuente_id" debe ser un número entero positivo.', 400);
      }
    }

    let rssService;
    try {
      // eslint-disable-next-line global-require
      rssService = require('../services/rssService');
    } catch (err) {
      throw new CodigoError('El servicio de actualización de RSS no está disponible en este momento.', 503);
    }

    if (fuenteId) {
      const resultado = await rssService.actualizarFuente(fuenteId);
      res.json({
        fuentesLeidas: 1,
        noticiasNuevas: resultado.noticiasNuevas || 0,
        errores: resultado.error ? [{ fuente: fuenteId, error: resultado.error }] : [],
      });
    } else {
      const resultado = await rssService.actualizarTodas();
      res.json(resultado);
    }
  })
);

// GET /api/admin/publicidades
router.get(
  '/publicidades',
  asyncHandler(async (req, res) => {
    const filas = db.consultar('SELECT * FROM publicidades ORDER BY creada_en DESC');
    res.json(filas.map((p) => ({ ...p, activa: Boolean(p.activa) })));
  })
);

// POST /api/admin/publicidades
router.post(
  '/publicidades',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};

    const nombre = requerirString(cuerpo.nombre, 'nombre', { maxLength: 150 });
    const imagenUrl = requerirUrl(cuerpo.imagen_url, 'imagen_url', { maxLength: 500 });
    const linkDestino = requerirUrl(cuerpo.link_destino, 'link_destino', { maxLength: 500 });
    const posicion = requerirString(cuerpo.posicion, 'posicion', { maxLength: 20 });
    if (!POSICIONES_PUBLICIDAD.includes(posicion)) {
      throw new CodigoError(`El campo "posicion" debe ser una de: ${POSICIONES_PUBLICIDAD.join(', ')}.`, 400);
    }
    const empresaNombre = requerirString(cuerpo.empresa_nombre, 'empresa_nombre', { maxLength: 150 });
    const empresaContacto =
      cuerpo.empresa_contacto === undefined || cuerpo.empresa_contacto === ''
        ? null
        : requerirString(cuerpo.empresa_contacto, 'empresa_contacto', { maxLength: 200 });
    const montoMensual = aMontoOpcional(cuerpo.monto_mensual, 'monto_mensual');
    const fechaInicio = validarFechaISO(cuerpo.fecha_inicio, 'fecha_inicio') || null;
    const fechaFin = validarFechaISO(cuerpo.fecha_fin, 'fecha_fin') || null;
    const activa = cuerpo.activa === undefined ? 1 : aBooleanoDB(cuerpo.activa);

    const resultado = db.ejecutar(
      `INSERT INTO publicidades
         (nombre, imagen_url, link_destino, posicion, activa, fecha_inicio, fecha_fin,
          empresa_nombre, empresa_contacto, monto_mensual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, imagenUrl, linkDestino, posicion, activa, fechaInicio, fechaFin,
        empresaNombre, empresaContacto, montoMensual]
    );

    const fila = db.consultarUno('SELECT * FROM publicidades WHERE id = ?', [resultado.lastInsertRowid]);
    res.status(201).json({ ...fila, activa: Boolean(fila.activa) });
  })
);

// PUT /api/admin/publicidades/:id
router.put(
  '/publicidades/:id',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la publicidad no es válido.', 400);

    const existente = db.consultarUno('SELECT * FROM publicidades WHERE id = ?', [id]);
    if (!existente) throw new CodigoError('La publicidad solicitada no existe.', 404);

    const cuerpo = req.body || {};
    const campos = [];
    const valores = [];

    if (cuerpo.nombre !== undefined) {
      campos.push('nombre = ?');
      valores.push(requerirString(cuerpo.nombre, 'nombre', { maxLength: 150 }));
    }
    if (cuerpo.imagen_url !== undefined) {
      campos.push('imagen_url = ?');
      valores.push(requerirUrl(cuerpo.imagen_url, 'imagen_url', { maxLength: 500 }));
    }
    if (cuerpo.link_destino !== undefined) {
      campos.push('link_destino = ?');
      valores.push(requerirUrl(cuerpo.link_destino, 'link_destino', { maxLength: 500 }));
    }
    if (cuerpo.posicion !== undefined) {
      const posicion = requerirString(cuerpo.posicion, 'posicion', { maxLength: 20 });
      if (!POSICIONES_PUBLICIDAD.includes(posicion)) {
        throw new CodigoError(`El campo "posicion" debe ser una de: ${POSICIONES_PUBLICIDAD.join(', ')}.`, 400);
      }
      campos.push('posicion = ?');
      valores.push(posicion);
    }
    if (cuerpo.activa !== undefined) {
      campos.push('activa = ?');
      valores.push(aBooleanoDB(cuerpo.activa));
    }
    if (cuerpo.empresa_nombre !== undefined) {
      campos.push('empresa_nombre = ?');
      valores.push(requerirString(cuerpo.empresa_nombre, 'empresa_nombre', { maxLength: 150 }));
    }
    if (cuerpo.empresa_contacto !== undefined) {
      campos.push('empresa_contacto = ?');
      valores.push(
        cuerpo.empresa_contacto === null || cuerpo.empresa_contacto === ''
          ? null
          : requerirString(cuerpo.empresa_contacto, 'empresa_contacto', { maxLength: 200 })
      );
    }
    if (cuerpo.monto_mensual !== undefined) {
      campos.push('monto_mensual = ?');
      valores.push(aMontoOpcional(cuerpo.monto_mensual, 'monto_mensual'));
    }
    if (cuerpo.fecha_inicio !== undefined) {
      campos.push('fecha_inicio = ?');
      valores.push(cuerpo.fecha_inicio === null ? null : validarFechaISO(cuerpo.fecha_inicio, 'fecha_inicio'));
    }
    if (cuerpo.fecha_fin !== undefined) {
      campos.push('fecha_fin = ?');
      valores.push(cuerpo.fecha_fin === null ? null : validarFechaISO(cuerpo.fecha_fin, 'fecha_fin'));
    }

    if (campos.length === 0) {
      throw new CodigoError('No se recibió ningún campo para actualizar.', 400);
    }

    db.ejecutar(`UPDATE publicidades SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]);

    const fila = db.consultarUno('SELECT * FROM publicidades WHERE id = ?', [id]);
    res.json({ ...fila, activa: Boolean(fila.activa) });
  })
);

// DELETE /api/admin/publicidades/:id
router.delete(
  '/publicidades/:id',
  asyncHandler(async (req, res) => {
    const id = aEnteroPositivo(req.params.id);
    if (!id) throw new CodigoError('El identificador de la publicidad no es válido.', 400);

    const resultado = db.ejecutar('DELETE FROM publicidades WHERE id = ?', [id]);
    if (resultado.changes === 0) {
      throw new CodigoError('La publicidad solicitada no existe.', 404);
    }

    res.json({ ok: true });
  })
);

// GET /api/admin/config
router.get(
  '/config',
  asyncHandler(async (req, res) => {
    const filas = db.consultar('SELECT clave, valor FROM configuracion');
    const config = {};
    for (const fila of filas) {
      config[fila.clave] = fila.valor;
    }
    res.json(config);
  })
);

// PUT /api/admin/config
router.put(
  '/config',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    const clavesRecibidas = Object.keys(cuerpo);

    if (clavesRecibidas.length === 0) {
      throw new CodigoError('No se recibió ningún campo de configuración para actualizar.', 400);
    }

    const clavesInvalidas = clavesRecibidas.filter((clave) => !CLAVES_CONFIGURACION_VALIDAS.includes(clave));
    if (clavesInvalidas.length > 0) {
      throw new CodigoError(`Clave(s) de configuración desconocida(s): ${clavesInvalidas.join(', ')}.`, 400);
    }

    const valoresAGuardar = {};

    if (cuerpo.nombre_portal !== undefined) {
      valoresAGuardar.nombre_portal = requerirString(cuerpo.nombre_portal, 'nombre_portal', { maxLength: 150 });
    }
    if (cuerpo.logo_url !== undefined) {
      valoresAGuardar.logo_url =
        cuerpo.logo_url === '' ? '' : requerirUrl(cuerpo.logo_url, 'logo_url', { maxLength: 500 });
    }
    if (cuerpo.color_primario !== undefined) {
      if (typeof cuerpo.color_primario !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(cuerpo.color_primario)) {
        throw new CodigoError('El campo "color_primario" debe ser un color hexadecimal (#rrggbb).', 400);
      }
      valoresAGuardar.color_primario = cuerpo.color_primario;
    }
    if (cuerpo.color_acento !== undefined) {
      if (typeof cuerpo.color_acento !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(cuerpo.color_acento)) {
        throw new CodigoError('El campo "color_acento" debe ser un color hexadecimal (#rrggbb).', 400);
      }
      valoresAGuardar.color_acento = cuerpo.color_acento;
    }
    if (cuerpo.color_fondo !== undefined) {
      if (typeof cuerpo.color_fondo !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(cuerpo.color_fondo)) {
        throw new CodigoError('El campo "color_fondo" debe ser un color hexadecimal (#rrggbb).', 400);
      }
      valoresAGuardar.color_fondo = cuerpo.color_fondo;
    }
    if (cuerpo.tamano_fuente_base !== undefined) {
      const tamano = String(cuerpo.tamano_fuente_base);
      if (!TAMANOS_FUENTE_VALIDOS.includes(tamano)) {
        throw new CodigoError(
          `El campo "tamano_fuente_base" debe ser uno de: ${TAMANOS_FUENTE_VALIDOS.join(', ')}.`,
          400
        );
      }
      valoresAGuardar.tamano_fuente_base = tamano;
    }
    if (cuerpo.intervalo_rss_minutos !== undefined) {
      const minutos = parseInt(cuerpo.intervalo_rss_minutos, 10);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 1440) {
        throw new CodigoError('El campo "intervalo_rss_minutos" debe ser un entero entre 1 y 1440.', 400);
      }
      valoresAGuardar.intervalo_rss_minutos = String(minutos);
    }
    if (cuerpo.noticias_por_pagina !== undefined) {
      const cantidad = parseInt(cuerpo.noticias_por_pagina, 10);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
        throw new CodigoError('El campo "noticias_por_pagina" debe ser un entero entre 1 y 100.', 400);
      }
      valoresAGuardar.noticias_por_pagina = String(cantidad);
    }
    if (cuerpo.texto_legal_footer !== undefined) {
      valoresAGuardar.texto_legal_footer = requerirString(cuerpo.texto_legal_footer, 'texto_legal_footer', {
        maxLength: 3000,
      });
    }

    for (const [clave, valor] of Object.entries(valoresAGuardar)) {
      db.ejecutar(
        `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
        [clave, valor]
      );
    }

    if (valoresAGuardar.intervalo_rss_minutos !== undefined) {
      try {
        // eslint-disable-next-line global-require
        const scheduler = require('../services/scheduler');
        scheduler.reprogramar(parseInt(valoresAGuardar.intervalo_rss_minutos, 10));
      } catch (err) {
        console.warn(
          'Advertencia: no se pudo reprogramar services/scheduler.js (puede que todavía no exista). Detalle:',
          err.message
        );
      }
    }

    const filas = db.consultar('SELECT clave, valor FROM configuracion');
    const config = {};
    for (const fila of filas) {
      config[fila.clave] = fila.valor;
    }
    res.json(config);
  })
);

// PUT /api/admin/password
router.put(
  '/password',
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    const passwordActual = requerirString(cuerpo.passwordActual, 'passwordActual', { maxLength: 200 });
    const passwordNueva = requerirString(cuerpo.passwordNueva, 'passwordNueva', {
      maxLength: 200,
      minLength: 8,
    });

    const fila = db.consultarUno('SELECT * FROM usuarios WHERE usuario = ?', [req.usuario]);
    if (!fila) {
      throw new CodigoError('El usuario autenticado ya no existe.', 401);
    }
    if (!bcrypt.compareSync(passwordActual, fila.password_hash)) {
      throw new CodigoError('La contraseña actual es incorrecta.', 400);
    }

    const nuevoHash = bcrypt.hashSync(passwordNueva, 10);
    db.ejecutar('UPDATE usuarios SET password_hash = ? WHERE id = ?', [nuevoHash, fila.id]);

    res.json({ ok: true });
  })
);

// GET /api/admin/logs?limite=50
router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const limiteQuery = aEnteroPositivo(req.query.limite);
    const limite = limiteQuery ? Math.min(limiteQuery, 500) : 50;

    const filas = db.consultar('SELECT * FROM logs ORDER BY datetime(fecha) DESC LIMIT ?', [limite]);
    res.json(filas);
  })
);

module.exports = router;
