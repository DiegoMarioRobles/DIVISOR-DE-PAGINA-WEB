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
// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  const codigo = err && Number.isInteger(err.codigo) && err.codigo >= 400 && err.codigo < 600
    ? err.codigo
    : 500;

  const mensaje =
    codigo === 500
      ? 'Ocurrió un error interno en el servidor. Intentá nuevamente más tarde.'
      : (err && err.mensaje) || (err && err.message) || 'Ocurrió un error.';

  if (codigo === 500) {
    console.error('Error no manejado:', err);
  }

  res.status(codigo).json({ error: true, mensaje, codigo });
}

module.exports = { manejadorErrores, asyncHandler, CodigoError };
