'use strict';

/**
 * Middleware de autenticación por JWT para el panel de administración.
 *
 * Interfaz fija (CONTRATO.md, sección 4bis):
 *   - verificarToken(req, res, next): middleware Express.
 *   - generarToken(usuario): devuelve un JWT firmado, válido 8 horas.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET =
  process.env.JWT_SECRET || 'clave-secreta-de-desarrollo-inseguro-cambiar-en-produccion';
const EXPIRACION_TOKEN = '8h';

/**
 * Genera un token JWT para el usuario autenticado.
 * @param {string} usuario
 * @returns {string} token JWT
 */
function generarToken(usuario) {
  return jwt.sign({ usuario }, JWT_SECRET, { expiresIn: EXPIRACION_TOKEN });
}

/**
 * Middleware Express que valida el header "Authorization: Bearer <token>".
 * Si falta o es inválido, responde 401 con el formato de error unificado.
 * Si es válido, agrega `req.usuario` con el nombre de usuario del token.
 */
function verificarToken(req, res, next) {
  const encabezado = req.headers['authorization'] || req.headers['Authorization'];

  if (!encabezado || typeof encabezado !== 'string' || !encabezado.startsWith('Bearer ')) {
    return res.status(401).json({
      error: true,
      mensaje: 'Falta el token de autenticación.',
      codigo: 401,
    });
  }

  const token = encabezado.slice('Bearer '.length).trim();

  if (!token) {
    return res.status(401).json({
      error: true,
      mensaje: 'Falta el token de autenticación.',
      codigo: 401,
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload.usuario;
    return next();
  } catch (err) {
    return res.status(401).json({
      error: true,
      mensaje: 'El token es inválido o expiró. Iniciá sesión nuevamente.',
      codigo: 401,
    });
  }
}

module.exports = { verificarToken, generarToken };
