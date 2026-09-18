'use strict';

/**
 * Manejo centralizado de errores.
 *
 * Exporta:
 *  - manejadorErrores: middleware global de Express (4 argumentos) que
 *    captura cualquier excepción no manejada y responde siempre con el
 *    formato unificado `{ error: true, mensaje, codigo }`.
 *  - asyncHandler: envoltorio para handlers async, para no repetir
 *    try/catch en cada ruta.
 *  - CodigoError: clase de error con un `codigo` HTTP asociado, para
 *    lanzar errores de negocio (400, 404, etc.) desde cualquier ruta.
 */

class CodigoError extends Error {
  constructor(mensaje, codigo = 500) {
    super(mensaje);
    this.name = 'CodigoError';
    this.codigo = codigo;
  }
}

/**
 * Envuelve un handler async de Express para que cualquier excepción
 * (o promesa rechazada) caiga automáticamente en `next(err)`.
 * @param {Function} fn - (req, res, next) => Promise
 */
function asyncHandler(fn) {
  return function envuelto(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Middleware global de manejo de errores de Express. Debe registrarse
 * al final de la cadena de middlewares, después de todas las rutas.
 */
function esCodigoHttpValido(valor) {
  return Number.isInteger(valor) && valor >= 400 && valor < 600;
}

// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  // `err.codigo` es lo que usan los CodigoError propios de esta app.
  // `err.status` / `err.statusCode` son los que usan Express y sus
  // middlewares internos (por ejemplo, express.json() ante un body con
  // JSON mal formado responde con status 400): también los respetamos
  // para no convertir errores de entrada del cliente en un 500.
  let codigo = 500;
  if (esCodigoHttpValido(err && err.codigo)) {
    codigo = err.codigo;
  } else if (esCodigoHttpValido(err && err.status)) {
    codigo = err.status;
  } else if (esCodigoHttpValido(err && err.statusCode)) {
    codigo = err.statusCode;
  }

  const mensaje =
    codigo === 500
      ? 'Ocurrió un error interno en el servidor. Intentá nuevamente más tarde.'
      : (err && err.mensaje) ||
        (codigo === 400 && err && err.type === 'entity.parse.failed'
          ? 'El cuerpo de la petición no es un JSON válido.'
          : (err && err.message)) ||
        'Ocurrió un error.';

  if (codigo === 500) {
    console.error('Error no manejado:', err);
  }

  res.status(codigo).json({ error: true, mensaje, codigo });
}

module.exports = { manejadorErrores, asyncHandler, CodigoError };
