'use strict';

/**
 * Rutas públicas (sin autenticación) — CONTRATO.md, sección 2.
 */

const express = require('express');
const db = require('../database/db');
const { asyncHandler, CodigoError } = require('../middleware/errores');
const { obtenerClimaYDolar } = require('../services/climaDolarService');

const router = express.Router();

// Lista fija de categorías. Si `services/categorizador.js` (Subagente D)
// ya existe, se usa su export `CATEGORIAS` para no duplicar la fuente de
// verdad; si todavía no existe, se usa este respaldo (mismos valores que
// el CONTRATO.md) para que `/api/categorias` funcione igual.
const CATEGORIAS_POR_DEFECTO = [
  'Policía Bonaerense',
  'Narcotráfico',
  'Accidentes',
  'Detenciones',
  'Seguridad Vial',
  'Justicia',
  'General',
];

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

const POSICIONES_PUBLICIDAD = ['header', 'sidebar', 'entre-noticias', 'footer'];

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

    const condiciones = ['oculta = 0'];
    const parametros = [];

    if (categoria) {
      if (categoria.length > 100) {
        throw new CodigoError('La categoría indicada no es válida.', 400);
      }
      condiciones.push('categoria = ?');
      parametros.push(categoria);
    }

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

// GET /api/noticias/destacada
router.get(
  '/noticias/destacada',
  asyncHandler(async (req, res) => {
    let fila = db.consultarUno(
      `SELECT * FROM noticias WHERE oculta = 0 AND destacada = 1
       ORDER BY datetime(fecha_publicacion) DESC LIMIT 1`
    );

    if (!fila) {
      fila = db.consultarUno(
        `SELECT * FROM noticias WHERE oculta = 0
         ORDER BY datetime(fecha_publicacion) DESC LIMIT 1`
      );
    }

    if (!fila) {
      return res.json(null);
    }

    res.json(mapearNoticiaDetalle(fila));
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

    const whereSql = `WHERE oculta = 0 AND (titulo LIKE ? ESCAPE '\\' OR resumen LIKE ? ESCAPE '\\')`;
    const parametrosBase = [patron, patron];

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

// GET /api/clima-dolar
router.get(
  '/clima-dolar',
  asyncHandler(async (req, res) => {
    const datos = await obtenerClimaYDolar();
    res.json(datos);
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
