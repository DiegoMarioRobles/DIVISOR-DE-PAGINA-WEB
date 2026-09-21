'use strict';

/**
 * Rutas públicas (sin autenticación) — CONTRATO.md, sección 2.
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../database/db');
const { asyncHandler, CodigoError } = require('../middleware/errores');
const { obtenerClimaYDolar, LOCALIDADES } = require('../services/climaDolarService');
const { enviarMailConfirmacion } = require('../services/emailService');

const router = express.Router();

// Lista fija de categorías. Si `services/categorizador.js` (Subagente D)
// ya existe, se usa su export `CATEGORIAS` para no duplicar la fuente de
// verdad; si todavía no existe, se usa este respaldo (mismos valores que
// el CONTRATO.md) para que `/api/categorias` funcione igual.
const CATEGORIAS_POR_DEFECTO = ['Policial', 'Político', 'Deportivo'];

// 'General' es la categoría de reserva del categorizador (ver
// services/categorizador.js): existe para que siempre haya dónde guardar
// lo que no matchea ninguna palabra clave, pero no se expone como sección
// propia del portal público (el administrador pidió que la navegación
// tenga exactamente estas 3 secciones temáticas, más "Todo" que no es
// una categoría real sino el listado sin filtrar).
function obtenerCategorias() {
  try {
    // eslint-disable-next-line global-require
    const categorizador = require('../services/categorizador');
    if (Array.isArray(categorizador.CATEGORIAS) && categorizador.CATEGORIAS.length > 0) {
      return categorizador.CATEGORIAS.filter((c) => c !== 'General');
    }
    return CATEGORIAS_POR_DEFECTO;
  } catch (err) {
    return CATEGORIAS_POR_DEFECTO;
  }
}

const POSICIONES_PUBLICIDAD = ['header', 'sidebar', 'entre-noticias', 'footer', 'destacada'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Filtro de antigüedad para /api/noticias y /api/buscar: cada valor es el
// modificador SQLite de datetime() correspondiente. Son literales fijos
// escritos acá mismo (nunca texto que venga del usuario), así que
// interpolarlos directo en la consulta es seguro; lo que sí viene del
// usuario (`req.query.periodo`) solo se usa para buscar la clave en este
// objeto, nunca se concatena directo.
const PERIODOS_VALIDOS = {
  '1h': "datetime('now', '-1 hours')",
  '24h': "datetime('now', '-24 hours')",
  '7d': "datetime('now', '-7 days')",
  '30d': "datetime('now', '-30 days')",
};

/**
 * Valida `req.query.periodo` contra PERIODOS_VALIDOS y, si viene uno
 * válido, agrega la condición correspondiente a `condiciones` (por
 * referencia). Tira CodigoError 400 si el valor no es ninguno de los
 * permitidos. Un período vacío/ausente no agrega ninguna condición (sin
 * filtro de antigüedad, se listan noticias de cualquier fecha).
 * @param {string[]} condiciones
 * @param {unknown} periodoQuery
 */
function aplicarFiltroPeriodo(condiciones, periodoQuery) {
  const periodo = typeof periodoQuery === 'string' ? periodoQuery.trim() : '';
  if (!periodo) return;
  const modificador = PERIODOS_VALIDOS[periodo];
  if (!modificador) {
    throw new CodigoError(
      `El período indicado no es válido. Debe ser uno de: ${Object.keys(PERIODOS_VALIDOS).join(', ')}.`,
      400
    );
  }
  condiciones.push(`datetime(fecha_publicacion) >= ${modificador}`);
}

function paginaHtml(titulo, mensaje) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${titulo} — El Observador</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{font-family:system-ui,sans-serif;background:#0a0e1a;color:#f2f3f7;display:flex;
       align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1.5rem;text-align:center;}
  .caja{max-width:420px;}
  h1{color:#fff;font-size:1.4rem;}
  p{color:#9aa0c0;}
  a{color:#e0263a;font-weight:bold;}
</style></head>
<body><div class="caja"><h1>${titulo}</h1><p>${mensaje}</p><p><a href="/">Volver a El Observador</a></p></div></body></html>`;
}

const limitadorSuscripcion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: true,
      mensaje: 'Demasiadas solicitudes de suscripción. Esperá unos minutos y volvé a intentar.',
      codigo: 429,
    });
  },
});

function obtenerLimitePorDefecto() {
  const fila = db.consultarUno('SELECT valor FROM configuracion WHERE clave = ?', [
    'noticias_por_pagina',
  ]);
  const valor = fila ? parseInt(fila.valor, 10) : NaN;
  return Number.isInteger(valor) && valor > 0 ? valor : 20;
}

function parsearPagina(valor) {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function parsearLimite(valor, porDefecto) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n) || n <= 0) return porDefecto;
  return Math.min(n, 100);
}

function escaparLike(texto) {
  // Escapa los comodines de LIKE para que la búsqueda sea literal.
  return texto.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function aBooleano(valor) {
  return valor === 1 || valor === true;
}

function mapearNoticiaLista(fila) {
  return {
    id: fila.id,
    titulo: fila.titulo,
    resumen: fila.resumen,
    imagen_url: fila.imagen_url,
    link_original: fila.link_original,
    fecha_publicacion: fila.fecha_publicacion,
    fuente_nombre: fila.fuente_nombre,
    categoria: fila.categoria,
    destacada: aBooleano(fila.destacada),
    es_propia: aBooleano(fila.es_propia),
  };
}

function mapearNoticiaDetalle(fila) {
  return {
    id: fila.id,
    titulo: fila.titulo,
    resumen: fila.resumen,
    contenido_propio: fila.contenido_propio,
    imagen_url: fila.imagen_url,
    link_original: fila.link_original,
    fecha_publicacion: fila.fecha_publicacion,
    fuente_nombre: fila.fuente_nombre,
    categoria: fila.categoria,
    destacada: aBooleano(fila.destacada),
    es_propia: aBooleano(fila.es_propia),
    vistas: fila.vistas,
  };
}

// GET /api/noticias?pagina=1&categoria=&limite=20
router.get(
  '/noticias',
  asyncHandler(async (req, res) => {
    const pagina = parsearPagina(req.query.pagina);
    const limite = parsearLimite(req.query.limite, obtenerLimitePorDefecto());
    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '';

    // Se excluyen las noticias sin imagen: en un portal de noticias, una
    // tarjeta con el cartel "Sin imagen disponible" se ve poco profesional
    // y rompe la grilla. La noticia no se borra (sigue en la base y visible
    // desde el panel de admin): si más adelante se le consigue una imagen
    // (ver `services/rssService.js`, obtenerImagenDesdeArticulo), vuelve a
    // aparecer sola en el próximo listado.
    const condiciones = ['oculta = 0', "imagen_url IS NOT NULL AND imagen_url != ''"];
    const parametros = [];

    if (categoria) {
      if (categoria.length > 100) {
        throw new CodigoError('La categoría indicada no es válida.', 400);
      }
      condiciones.push('categoria = ?');
      parametros.push(categoria);
    }

    aplicarFiltroPeriodo(condiciones, req.query.periodo);

    const whereSql = `WHERE ${condiciones.join(' AND ')}`;

    const filaTotal = db.consultarUno(
      `SELECT COUNT(*) AS total FROM noticias ${whereSql}`,
      parametros
    );
    const total = filaTotal ? filaTotal.total : 0;
    const totalPaginas = total > 0 ? Math.ceil(total / limite) : 0;
    const offset = (pagina - 1) * limite;

    const filas = db.consultar(
      `SELECT id, titulo, resumen, imagen_url, link_original, fecha_publicacion,
              fuente_nombre, categoria, destacada, es_propia
       FROM noticias
       ${whereSql}
       ORDER BY datetime(fecha_publicacion) DESC
       LIMIT ? OFFSET ?`,
      [...parametros, limite, offset]
    );

    res.json({
      noticias: filas.map(mapearNoticiaLista),
      total,
      pagina,
      totalPaginas,
    });
  })
);

// GET /api/noticias/destacada -> array de hasta CANDIDATOS_DESTACADA
// noticias. MAX_DESTACADAS (3) es cuántas se terminan MOSTRANDO en la
// portada; se piden más de las que hacen falta para que el cliente
// pueda elegir las primeras 3 cuya imagen realmente cargue en el
// navegador (ver public/js/main.js, cargarDestacada) sin depender de
// que haya publicidad de relleno cargada — el relleno publicitario
// sigue existiendo como último recurso, para cuando ni con este margen
// alcanza.
const MAX_DESTACADAS = 3;
const CANDIDATOS_DESTACADA = 8;

router.get(
  '/noticias/destacada',
  asyncHandler(async (req, res) => {
    // Mismo criterio que /api/noticias: no se muestran noticias sin
    // imagen (se ven mal en las tarjetas grandes de "destacada").
    const condicionImagen = "imagen_url IS NOT NULL AND imagen_url != ''";

    // Las marcadas a mano por el administrador van siempre primero (son
    // como máximo MAX_DESTACADAS, es el límite que ya impone el panel
    // admin al marcarlas).
    const marcadas = db.consultar(
      `SELECT * FROM noticias WHERE oculta = 0 AND destacada = 1 AND ${condicionImagen}
       ORDER BY datetime(fecha_publicacion) DESC LIMIT ?`,
      [MAX_DESTACADAS]
    );

    let destacadas = marcadas;
    if (destacadas.length < CANDIDATOS_DESTACADA) {
      const idsExcluidos = destacadas.map((n) => n.id);
      const condicionExcluir = idsExcluidos.length
        ? `AND id NOT IN (${idsExcluidos.map(() => '?').join(',')})`
        : '';
      const relleno = db.consultar(
        `SELECT * FROM noticias WHERE oculta = 0 AND ${condicionImagen} ${condicionExcluir}
         ORDER BY datetime(fecha_publicacion) DESC LIMIT ?`,
        [...idsExcluidos, CANDIDATOS_DESTACADA - destacadas.length]
      );
      destacadas = destacadas.concat(relleno);
    }

    res.json(destacadas.map(mapearNoticiaDetalle));
  })
);

// GET /api/noticias/:id
router.get(
  '/noticias/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CodigoError('El identificador de la noticia no es válido.', 400);
    }

    const fila = db.consultarUno('SELECT * FROM noticias WHERE id = ? AND oculta = 0', [id]);
    if (!fila) {
      throw new CodigoError('La noticia solicitada no existe.', 404);
    }

    db.ejecutar('UPDATE noticias SET vistas = vistas + 1 WHERE id = ?', [id]);
    fila.vistas += 1;

    res.json(mapearNoticiaDetalle(fila));
  })
);

// GET /api/categorias
router.get(
  '/categorias',
  asyncHandler(async (req, res) => {
    res.json(obtenerCategorias());
  })
);

// GET /api/buscar?q=texto&pagina=1
router.get(
  '/buscar',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      throw new CodigoError('El parámetro "q" es requerido para buscar.', 400);
    }
    if (q.length > 200) {
      throw new CodigoError('El texto de búsqueda es demasiado largo.', 400);
    }

    const pagina = parsearPagina(req.query.pagina);
    const limite = parsearLimite(req.query.limite, obtenerLimitePorDefecto());
    const patron = `%${escaparLike(q)}%`;

    const condiciones = ['oculta = 0', "(titulo LIKE ? ESCAPE '\\' OR resumen LIKE ? ESCAPE '\\')"];
    const parametrosBase = [patron, patron];
    aplicarFiltroPeriodo(condiciones, req.query.periodo);
    const whereSql = `WHERE ${condiciones.join(' AND ')}`;

    const filaTotal = db.consultarUno(
      `SELECT COUNT(*) AS total FROM noticias ${whereSql}`,
      parametrosBase
    );
    const total = filaTotal ? filaTotal.total : 0;
    const totalPaginas = total > 0 ? Math.ceil(total / limite) : 0;
    const offset = (pagina - 1) * limite;

    const filas = db.consultar(
      `SELECT id, titulo, resumen, imagen_url, link_original, fecha_publicacion,
              fuente_nombre, categoria, destacada, es_propia
       FROM noticias
       ${whereSql}
       ORDER BY datetime(fecha_publicacion) DESC
       LIMIT ? OFFSET ?`,
      [...parametrosBase, limite, offset]
    );

    res.json({
      noticias: filas.map(mapearNoticiaLista),
      total,
      pagina,
      totalPaginas,
    });
  })
);

// Claves de "configuracion" seguras para exponer públicamente (lo visual
// y el texto legal). Nunca se exponen acá claves operativas como
// intervalo_rss_minutos o noticias_por_pagina.
const CLAVES_TEMA_PUBLICAS = [
  'nombre_portal',
  'logo_url',
  'color_primario',
  'color_acento',
  'color_fondo',
  'tamano_fuente_base',
  'texto_legal_footer',
];

// GET /api/tema -> apariencia configurada desde el panel admin
// (Configuración → Apariencia), para que el portal público la aplique al
// cargar (título, logo, colores, tamaño de letra, texto legal).
router.get(
  '/tema',
  asyncHandler(async (req, res) => {
    const filas = db.consultar(
      `SELECT clave, valor FROM configuracion WHERE clave IN (${CLAVES_TEMA_PUBLICAS.map(() => '?').join(',')})`,
      CLAVES_TEMA_PUBLICAS
    );
    const tema = {};
    for (const fila of filas) {
      tema[fila.clave] = fila.valor;
    }
    res.json(tema);
  })
);

// GET /api/fuentes
router.get(
  '/fuentes',
  asyncHandler(async (req, res) => {
    const filas = db.consultar(
      'SELECT id, nombre, sitio_web FROM fuentes WHERE activa = 1 ORDER BY nombre ASC'
    );
    res.json(filas);
  })
);

// GET /api/publicidades?posicion=sidebar
router.get(
  '/publicidades',
  asyncHandler(async (req, res) => {
    const posicion = typeof req.query.posicion === 'string' ? req.query.posicion.trim() : '';
    if (!posicion || !POSICIONES_PUBLICIDAD.includes(posicion)) {
      throw new CodigoError(
        `El parámetro "posicion" es requerido y debe ser una de: ${POSICIONES_PUBLICIDAD.join(', ')}.`,
        400
      );
    }

    const filas = db.consultar(
      `SELECT id, nombre, imagen_url, link_destino, posicion
       FROM publicidades
       WHERE activa = 1
         AND posicion = ?
         AND (fecha_inicio IS NULL OR date(fecha_inicio) <= date('now'))
         AND (fecha_fin IS NULL OR date(fecha_fin) >= date('now'))
       ORDER BY creada_en DESC`,
      [posicion]
    );

    res.json(filas);
  })
);

// POST /api/suscriptores
router.post(
  '/suscriptores',
  limitadorSuscripcion,
  asyncHandler(async (req, res) => {
    const cuerpo = req.body || {};
    const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim().toLowerCase() : '';
    if (!email || email.length > 200 || !EMAIL_REGEX.test(email)) {
      throw new CodigoError('Ingresá un email válido.', 400);
    }

    const existente = db.consultarUno('SELECT * FROM suscriptores WHERE email = ?', [email]);
    const token = crypto.randomBytes(24).toString('hex');

    if (!existente) {
      db.ejecutar(
        'INSERT INTO suscriptores (email, token, confirmado, activo) VALUES (?, ?, 0, 1)',
        [email, token]
      );
      await enviarMailConfirmacion(email, token);
    } else if (!existente.confirmado || !existente.activo) {
      db.ejecutar(
        'UPDATE suscriptores SET token = ?, confirmado = 0, activo = 1 WHERE id = ?',
        [token, existente.id]
      );
      await enviarMailConfirmacion(email, token);
    }
    // Si ya estaba confirmado y activo no se reenvía nada (evita spam), pero
    // la respuesta es siempre la misma para no revelar si el mail ya existía.

    res.json({
      ok: true,
      mensaje: 'Si el mail es válido, te llegó un correo para confirmar la suscripción.',
    });
  })
);

// GET /api/suscriptores/confirmar?token=...  (se abre desde el link del mail)
router.get(
  '/suscriptores/confirmar',
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const fila = token ? db.consultarUno('SELECT * FROM suscriptores WHERE token = ?', [token]) : null;

    if (!fila) {
      res
        .status(404)
        .type('html')
        .send(paginaHtml('Link inválido', 'Este link de confirmación no es válido o ya venció.'));
      return;
    }

    if (!fila.confirmado) {
      db.ejecutar(
        "UPDATE suscriptores SET confirmado = 1, confirmado_en = datetime('now') WHERE id = ?",
        [fila.id]
      );
    }

    res
      .type('html')
      .send(paginaHtml('¡Listo!', 'Tu suscripción quedó confirmada. Ya vas a recibir las noticias nuevas por mail.'));
  })
);

// GET /api/suscriptores/baja?token=...  (se abre desde el link del mail)
router.get(
  '/suscriptores/baja',
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const fila = token ? db.consultarUno('SELECT * FROM suscriptores WHERE token = ?', [token]) : null;

    if (!fila) {
      res.status(404).type('html').send(paginaHtml('Link inválido', 'Este link de baja no es válido.'));
      return;
    }

    db.ejecutar('UPDATE suscriptores SET activo = 0 WHERE id = ?', [fila.id]);

    res
      .type('html')
      .send(paginaHtml('Listo', 'Te diste de baja correctamente. Ya no vas a recibir más mails de novedades.'));
  })
);

// POST /api/publicidades/:id/click
router.post(
  '/publicidades/:id/click',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CodigoError('El identificador de la publicidad no es válido.', 400);
    }

    const resultado = db.ejecutar('UPDATE publicidades SET clicks = clicks + 1 WHERE id = ?', [id]);
    if (resultado.changes === 0) {
      throw new CodigoError('La publicidad indicada no existe.', 404);
    }

    res.json({ ok: true });
  })
);

// GET /api/clima-dolar?localidad=la-plata
router.get(
  '/clima-dolar',
  asyncHandler(async (req, res) => {
    const datos = await obtenerClimaYDolar(req.query.localidad);
    res.json(datos);
  })
);

// GET /api/localidades -> lista fija para el selector del ticker público
router.get(
  '/localidades',
  asyncHandler(async (req, res) => {
    const lista = Object.entries(LOCALIDADES).map(([clave, { nombre }]) => ({ clave, nombre }));
    res.json(lista);
  })
);

// POST /api/publicidades/:id/impresion
router.post(
  '/publicidades/:id/impresion',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CodigoError('El identificador de la publicidad no es válido.', 400);
    }

    const resultado = db.ejecutar('UPDATE publicidades SET impresiones = impresiones + 1 WHERE id = ?', [
      id,
    ]);
    if (resultado.changes === 0) {
      throw new CodigoError('La publicidad indicada no existe.', 404);
    }

    res.json({ ok: true });
  })
);

module.exports = router;
