'use strict';

/**
 * Envío de correos con Resend (https://resend.com) — API REST simple vía
 * `fetch`, sin dependencia npm adicional.
 *
 * Requiere las variables de entorno:
 *   RESEND_API_KEY - API key de tu cuenta de Resend.
 *   RESEND_FROM     - remitente, ej. "La Huella <noticias@tudominio.com>".
 *                      Sin un dominio propio verificado en Resend, solo se
 *                      puede mandar mail al mismo casillero con el que te
 *                      registraste en Resend (limitación de su modo sandbox,
 *                      no de este código).
 *   SITE_URL        - URL pública del sitio (para los links de confirmación
 *                      y baja de suscripción dentro del mail).
 *
 * Si `RESEND_API_KEY` no está configurada, el envío se salta con una
 * advertencia por consola en vez de romper el flujo que lo llama (alta de
 * suscriptor, envío del resumen de noticias nuevas): mandar mail nunca debe
 * ser un paso bloqueante para el resto del sitio.
 *
 * ⚠️ No se pudo probar en vivo contra la API real de Resend en este
 * entorno de desarrollo (salida de red bloqueada, igual que con los feeds
 * RSS y el clima/dólar). Es la API pública documentada de Resend
 * (`POST https://api.resend.com/emails`); confirmar el envío real apenas
 * se cargue una `RESEND_API_KEY` válida en producción.
 */

const db = require('../database/db');

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10000;

function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tiempo de espera agotado al enviar el mail.')), ms);
    }),
  ]);
}

function obtenerUrlBase() {
  return (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

/**
 * Envía un único correo vía la API de Resend. No lanza excepción: devuelve
 * `{ok: true}` o `{ok: false, error}`, para que quien lo llama decida qué
 * hacer sin que un fallo de mail rompa el resto del flujo.
 * @param {{to: string, subject: string, html: string}} datos
 */
async function enviarCorreo({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    console.warn(
      '[emailService] RESEND_API_KEY o RESEND_FROM no están configuradas: no se envió el mail a',
      to
    );
    return { ok: false, error: 'Envío de mail no configurado.' };
  }

  try {
    const respuesta = await conTimeout(
      fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
      }),
      TIMEOUT_MS
    );

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new Error(`Resend respondió ${respuesta.status}: ${detalle}`);
    }
    return { ok: true };
  } catch (err) {
    console.error('[emailService] No se pudo enviar el mail a', to, '-', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Manda el mail de confirmación de suscripción (doble opt-in).
 * @param {string} email
 * @param {string} token
 */
async function enviarMailConfirmacion(email, token) {
  const urlConfirmar = `${obtenerUrlBase()}/api/suscriptores/confirmar?token=${encodeURIComponent(token)}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0e1a;color:#f2f3f7;">
      <h1 style="color:#ffffff;font-size:22px;">La Huella</h1>
      <p>Confirmá tu suscripción para recibir las noticias nuevas por mail.</p>
      <p>
        <a href="${urlConfirmar}" style="display:inline-block;background:#e0263a;color:#ffffff;
           padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Confirmar suscripción
        </a>
      </p>
      <p style="font-size:12px;color:#9aa0c0;">Si no pediste esta suscripción, ignorá este mail.</p>
    </div>`;

  return enviarCorreo({ to: email, subject: 'Confirmá tu suscripción a La Huella', html });
}

/**
 * Manda a todos los suscriptores confirmados y activos un resumen de las
 * noticias nuevas de la última lectura RSS. Se llama automáticamente desde
 * `services/rssService.js` cuando una lectura trae noticias nuevas.
 * Nunca lanza excepción: los fallos de envío individuales se registran en
 * consola y no afectan al resto de los suscriptores ni al proceso de RSS.
 * @param {number[]} idsNoticiasNuevas
 */
async function enviarResumenNuevasNoticias(idsNoticiasNuevas) {
  if (!Array.isArray(idsNoticiasNuevas) || idsNoticiasNuevas.length === 0) {
    return;
  }

  const marcadores = idsNoticiasNuevas.map(() => '?').join(',');
  const noticias = db.consultar(
    `SELECT titulo, resumen, link_original, fuente_nombre, categoria
     FROM noticias WHERE id IN (${marcadores}) ORDER BY datetime(fecha_publicacion) DESC`,
    idsNoticiasNuevas
  );
  if (noticias.length === 0) return;

  const suscriptores = db.consultar(
    'SELECT email, token FROM suscriptores WHERE confirmado = 1 AND activo = 1'
  );
  if (suscriptores.length === 0) return;

  const listaHtml = noticias
    .map(
      (n) => `
      <li style="margin-bottom:14px;">
        <span style="background:#e0263a;color:#fff;font-size:11px;font-weight:bold;
              text-transform:uppercase;padding:2px 6px;border-radius:3px;">${escaparHtml(n.categoria)}</span><br>
        <a href="${escaparAtributo(n.link_original)}" style="color:#f2f3f7;font-weight:bold;text-decoration:none;">
          ${escaparHtml(n.titulo)}
        </a><br>
        <span style="color:#9aa0c0;font-size:13px;">${escaparHtml(n.resumen)}</span><br>
        <span style="color:#676d94;font-size:12px;">Fuente: ${escaparHtml(n.fuente_nombre)}</span>
      </li>`
    )
    .join('');

  const resultados = await Promise.allSettled(
    suscriptores.map((s) => {
      const urlBaja = `${obtenerUrlBase()}/api/suscriptores/baja?token=${encodeURIComponent(s.token)}`;
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0a0e1a;color:#f2f3f7;">
          <h1 style="color:#ffffff;font-size:22px;">La Huella</h1>
          <p>Noticias nuevas de seguridad de la provincia de Buenos Aires:</p>
          <ul style="list-style:none;padding:0;">${listaHtml}</ul>
          <p style="font-size:11px;color:#676d94;margin-top:24px;">
            <a href="${urlBaja}" style="color:#676d94;">Cancelar suscripción</a>
          </p>
        </div>`;
      return enviarCorreo({
        to: s.email,
        subject: `${noticias.length} noticia(s) nueva(s) en La Huella`,
        html,
      });
    })
  );

  const fallidos = resultados.filter((r) => r.status === 'rejected' || (r.value && !r.value.ok)).length;
  if (fallidos > 0) {
    console.warn(`[emailService] ${fallidos} de ${suscriptores.length} resumen(es) de mail fallaron al enviarse.`);
  }
}

function escaparHtml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escaparAtributo(texto) {
  return escaparHtml(texto).replace(/'/g, '&#39;');
}

module.exports = {
  enviarMailConfirmacion,
  enviarResumenNuevasNoticias,
};
