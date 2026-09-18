'use strict';

/**
 * Capa de acceso a la base de datos SQLite.
 *
 * Usa `better-sqlite3` (driver síncrono, sin callbacks) tal como define
 * el CONTRATO.md, sección "4bis". Este módulo expone EXACTAMENTE tres
 * funciones (consultar, consultarUno, ejecutar) para que el resto del
 * backend (rutas propias y, potencialmente, módulos de otros
 * subagentes) trabaje siempre contra la misma interfaz.
 */

const path = require('path');
const Database = require('better-sqlite3');

const rutaBaseDeDatos = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data.db');

const conexion = new Database(rutaBaseDeDatos);

// WAL mejora la concurrencia lectura/escritura (útil porque el scheduler
// de RSS escribe en segundo plano mientras la API atiende pedidos).
conexion.pragma('journal_mode = WAL');
conexion.pragma('foreign_keys = ON');

/**
 * Ejecuta una consulta de lectura y devuelve un array de filas.
 * @param {string} sql - Sentencia SQL con placeholders "?".
 * @param {Array} params - Parámetros posicionales para los placeholders.
 * @returns {Array<Object>}
 */
function consultar(sql, params = []) {
  return conexion.prepare(sql).all(params);
}

/**
 * Ejecuta una consulta de lectura y devuelve una sola fila (o undefined
 * si no hay resultados).
 * @param {string} sql
 * @param {Array} params
 * @returns {Object|undefined}
 */
function consultarUno(sql, params = []) {
  return conexion.prepare(sql).get(params);
}

/**
 * Ejecuta una sentencia de escritura (INSERT/UPDATE/DELETE/DDL).
 * @param {string} sql
 * @param {Array} params
 * @returns {{changes: number, lastInsertRowid: number|bigint}}
 */
function ejecutar(sql, params = []) {
  const info = conexion.prepare(sql).run(params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

module.exports = {
  consultar,
  consultarUno,
  ejecutar,
};
