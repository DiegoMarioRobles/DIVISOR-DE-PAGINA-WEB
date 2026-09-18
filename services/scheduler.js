'use strict';

/**
 * Scheduler del motor RSS.
 *
 * Programa la lectura periódica de todas las fuentes activas usando
 * `node-cron`, con el intervalo guardado en la tabla `configuracion`
 * (clave `intervalo_rss_minutos`, 30 minutos por defecto si no está
 * seteada). Al iniciar, además de programar la tarea recurrente, dispara
 * una primera lectura inmediata sin esperar al primer disparo del cron.
 *
 * Contrato exacto (ver CONTRATO.md, sección 4bis):
 *   iniciar()            -> arma el cron con el intervalo actual y hace una lectura inicial
 *   reprogramar(minutos) -> cancela el cron previo y lo vuelve a armar con el nuevo intervalo
 */

const cron = require('node-cron');
const db = require('../database/db');
const rssService = require('./rssService');

const INTERVALO_MINUTOS_POR_DEFECTO = 30;

// Referencia a la tarea cron activa, guardada a nivel de módulo para
// poder cancelarla al reprogramar y no dejar tareas duplicadas corriendo
// en paralelo.
let tareaCron = null;

/**
 * Lee `intervalo_rss_minutos` de la tabla `configuracion`. Si la clave no
 * está seteada, no es un número válido, o falla la consulta (por ejemplo
 * porque la base todavía no está lista), devuelve el valor por defecto.
 * @returns {number} minutos, siempre un entero mayor a 0.
 */
function leerIntervaloConfigurado() {
  try {
    const fila = db.consultarUno('SELECT valor FROM configuracion WHERE clave = ?', [
      'intervalo_rss_minutos',
    ]);
    const minutos = fila && fila.valor !== undefined && fila.valor !== null ? parseInt(fila.valor, 10) : NaN;
    if (Number.isFinite(minutos) && minutos > 0) {
      return minutos;
    }
  } catch (err) {
    console.error(
      `[scheduler] No se pudo leer "intervalo_rss_minutos" de configuracion, se usa el valor por defecto (${INTERVALO_MINUTOS_POR_DEFECTO}):`,
      err && err.message ? err.message : err
    );
  }
  return INTERVALO_MINUTOS_POR_DEFECTO;
}

/**
 * Arma una expresión cron (formato estándar de 5 campos) que dispare cada
 * `minutos` minutos. El campo "minuto" de un cron estándar solo puede
 * expresar de forma exacta intervalos de 1 a 59 minutos (patrón "cada N"
 * del campo minuto); para
 * intervalos de una hora o más se usa el campo "hora" en su lugar. Un
 * intervalo que no sea múltiplo exacto de 60 minutos y que además supere
 * los 59 se aproxima al múltiplo de hora más cercano (caso límite, poco
 * frecuente en la práctica: el valor configurado normalmente ronda los 15
 * a 120 minutos).
 * @param {number} minutos
 * @returns {string} expresión cron de 5 campos.
 */
function construirExpresionCron(minutos) {
  const n = Math.max(1, Math.floor(minutos));

  if (n <= 59) {
    return `*/${n} * * * *`;
  }

  if (n % 60 === 0) {
    return `0 */${n / 60} * * *`;
  }

  const horasAproximadas = Math.max(1, Math.round(n / 60));
  console.warn(
    `[scheduler] El intervalo de ${n} minuto(s) no es múltiplo exacto de una hora; se aproxima a cada ${horasAproximadas} hora(s).`
  );
  return `0 */${horasAproximadas} * * *`;
}

/**
 * Dispara una lectura de todas las fuentes. Cualquier error del proceso
 * de actualización queda contenido acá adentro: nunca debe tirar abajo el
 * proceso de Node ni el propio disparo del cron.
 * @returns {Promise<void>}
 */
async function ejecutarActualizacion() {
  try {
    const resultado = await rssService.actualizarTodas();
    console.log(
      `[scheduler] Lectura RSS completa: ${resultado.fuentesLeidas} fuente(s) leída(s), ${resultado.noticiasNuevas} noticia(s) nueva(s), ${resultado.errores.length} error(es).`
    );
  } catch (err) {
    console.error(
      '[scheduler] Error inesperado al ejecutar actualizarTodas():',
      err && err.message ? err.message : err
    );
  }
}

/**
 * Arma y arranca una tarea cron nueva para el intervalo dado. No cancela
 * ninguna tarea previa: eso es responsabilidad de quien llama (`iniciar`
 * y `reprogramar`), para mantener en un solo lugar la regla de "nunca dos
 * tareas corriendo en paralelo".
 * @param {number} minutos
 * @returns {import('node-cron').ScheduledTask}
 */
function armarTarea(minutos) {
  const expresion = construirExpresionCron(minutos);
  return cron.schedule(expresion, () => {
    ejecutarActualizacion();
  });
}

/**
 * Inicia el scheduler: lee el intervalo configurado, programa la tarea
 * cron recurrente y dispara una primera lectura inmediata (sin esperar el
 * primer disparo del cron). Si ya había una tarea corriendo (por ejemplo,
 * si se llama `iniciar()` más de una vez), la cancela antes de armar la
 * nueva para no duplicar lecturas en paralelo.
 */
function iniciar() {
  const minutos = leerIntervaloConfigurado();

  if (tareaCron) {
    tareaCron.stop();
  }
  tareaCron = armarTarea(minutos);

  console.log(`[scheduler] Motor RSS programado cada ${minutos} minuto(s).`);

  // Primera lectura inmediata: no hace falta esperar al próximo disparo
  // del cron para tener noticias frescas apenas arranca el servidor.
  ejecutarActualizacion();
}

/**
 * Reprograma el intervalo de lectura: cancela la tarea cron previa y arma
 * una nueva con el intervalo indicado. Se usa desde
 * `PUT /api/admin/config` cuando cambia `intervalo_rss_minutos`.
 * @param {number} minutos
 */
function reprogramar(minutos) {
  const nuevoIntervalo =
    Number.isFinite(minutos) && minutos > 0 ? Math.floor(minutos) : INTERVALO_MINUTOS_POR_DEFECTO;

  if (tareaCron) {
    tareaCron.stop();
    tareaCron = null;
  }

  tareaCron = armarTarea(nuevoIntervalo);
  console.log(`[scheduler] Intervalo reprogramado a cada ${nuevoIntervalo} minuto(s).`);
}

module.exports = {
  iniciar,
  reprogramar,
};
