'use strict';

/**
 * Clima de La Plata y cotización del dólar en Argentina, para el ticker
 * informativo del portal. Usa APIs públicas gratuitas (sin API key):
 * Open-Meteo para clima y Bluelytics para cotizaciones.
 *
 * ⚠️ Estas URLs no se pudieron probar en vivo durante el desarrollo (el
 * sandbox donde se escribió este código tiene la salida de red bloqueada
 * hacia dominios arbitrarios). Son APIs públicas conocidas y documentadas,
 * pero conviene confirmar que responden apenas se despliegue con acceso a
 * internet real, y ajustar la URL si alguna cambió de forma.
 *
 * Si una de las dos falla, esa parte se devuelve en `null` en vez de
 * romper toda la respuesta: el ticker debe degradarse con elegancia.
 */

const LATITUD_LA_PLATA = -34.9214;
const LONGITUD_LA_PLATA = -57.9544;
const TIMEOUT_MS = 8000;
const CACHE_MS = 10 * 60 * 1000; // 10 minutos: evita golpear las APIs externas en cada visita.

let cache = { datos: null, expiraEn: 0 };

function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms);
    }),
  ]);
}

async function obtenerClima() {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LATITUD_LA_PLATA}&longitude=${LONGITUD_LA_PLATA}` +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m' +
    '&timezone=America%2FArgentina%2FBuenos_Aires';

  const respuesta = await conTimeout(fetch(url), TIMEOUT_MS);
  if (!respuesta.ok) {
    throw new Error(`Open-Meteo respondió ${respuesta.status}`);
  }
  const datos = await respuesta.json();
  const actual = datos && datos.current;
  if (!actual || typeof actual.temperature_2m !== 'number') {
    throw new Error('Respuesta de Open-Meteo sin datos actuales.');
  }

  return {
    temperatura: Math.round(actual.temperature_2m),
    humedad: Math.round(actual.relative_humidity_2m),
    viento: Math.round(actual.wind_speed_10m),
  };
}

async function obtenerDolar() {
  const respuesta = await conTimeout(fetch('https://api.bluelytics.com.ar/v2/latest'), TIMEOUT_MS);
  if (!respuesta.ok) {
    throw new Error(`Bluelytics respondió ${respuesta.status}`);
  }
  const datos = await respuesta.json();
  if (!datos || !datos.oficial || !datos.blue) {
    throw new Error('Respuesta de Bluelytics incompleta.');
  }

  return {
    oficial: { compra: datos.oficial.value_buy, venta: datos.oficial.value_sell },
    blue: { compra: datos.blue.value_buy, venta: datos.blue.value_sell },
  };
}

/**
 * Devuelve `{ clima, dolar, actualizado }`. `clima`/`dolar` son `null` si
 * esa fuente en particular falló; nunca lanza una excepción hacia arriba.
 * Cachea el resultado combinado por 10 minutos.
 */
async function obtenerClimaYDolar() {
  const ahora = Date.now();
  if (cache.datos && cache.expiraEn > ahora) {
    return cache.datos;
  }

  const [climaResultado, dolarResultado] = await Promise.allSettled([obtenerClima(), obtenerDolar()]);

  if (climaResultado.status === 'rejected') {
    console.error('No se pudo obtener el clima:', climaResultado.reason.message);
  }
  if (dolarResultado.status === 'rejected') {
    console.error('No se pudo obtener la cotización del dólar:', dolarResultado.reason.message);
  }

  const datos = {
    clima: climaResultado.status === 'fulfilled' ? climaResultado.value : null,
    dolar: dolarResultado.status === 'fulfilled' ? dolarResultado.value : null,
    actualizado: new Date().toISOString(),
  };

  cache = { datos, expiraEn: ahora + CACHE_MS };
  return datos;
}

module.exports = { obtenerClimaYDolar };
