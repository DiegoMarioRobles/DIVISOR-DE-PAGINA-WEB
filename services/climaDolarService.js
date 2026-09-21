'use strict';

/**
 * Clima por localidad y cotización del dólar en Argentina, para el ticker
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

// Localidades de cobertura del portal (coinciden con las zonas de
// seeds/fuentes.js). La clave es la que usa el selector del ticker
// público (`?localidad=`) y el panel admin no la gestiona: es una lista
// fija a propósito, no hace falta que sea editable.
const LOCALIDADES = {
  'la-plata': { nombre: 'La Plata', lat: -34.9214, lon: -57.9544 },
  quilmes: { nombre: 'Quilmes', lat: -34.7202, lon: -58.2545 },
  'lomas-de-zamora': { nombre: 'Lomas de Zamora', lat: -34.7628, lon: -58.4008 },
  avellaneda: { nombre: 'Avellaneda', lat: -34.6626, lon: -58.3654 },
  'almirante-brown': { nombre: 'Almirante Brown', lat: -34.7995, lon: -58.3877 },
  berisso: { nombre: 'Berisso', lat: -34.876, lon: -57.8842 },
  'florencio-varela': { nombre: 'Florencio Varela', lat: -34.8172, lon: -58.2745 },
  moron: { nombre: 'Morón', lat: -34.6534, lon: -58.6198 },
  moreno: { nombre: 'Moreno', lat: -34.6421, lon: -58.7898 },
  'san-isidro': { nombre: 'San Isidro', lat: -34.4708, lon: -58.5251 },
  tigre: { nombre: 'Tigre', lat: -34.4264, lon: -58.58 },
  'san-martin': { nombre: 'San Martín', lat: -34.5719, lon: -58.5389 },
  'la-matanza': { nombre: 'La Matanza (San Justo)', lat: -34.6788, lon: -58.5636 },
  lanus: { nombre: 'Lanús', lat: -34.7089, lon: -58.3925 },
};

const LOCALIDAD_POR_DEFECTO = 'la-plata';
const TIMEOUT_MS = 8000;
const CACHE_MS = 10 * 60 * 1000; // 10 minutos: evita golpear las APIs externas en cada visita.

// El clima se cachea por localidad (cada una pega a una URL distinta); el
// dólar es un único valor nacional, se cachea aparte y una sola vez.
const cacheClimaPorLocalidad = new Map();
let cacheDolar = { datos: null, expiraEn: 0 };

function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms);
    }),
  ]);
}

/**
 * Normaliza la clave de localidad recibida por query string: si no es
 * una de las conocidas, cae a la de por defecto (nunca rompe con un
 * valor inválido, simplemente ignora el filtro).
 * @param {unknown} valor
 * @returns {string}
 */
function normalizarLocalidad(valor) {
  const clave = typeof valor === 'string' ? valor.trim() : '';
  return LOCALIDADES[clave] ? clave : LOCALIDAD_POR_DEFECTO;
}

async function obtenerClima(localidadClave) {
  const localidad = LOCALIDADES[localidadClave];
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${localidad.lat}&longitude=${localidad.lon}` +
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

async function obtenerDolarCacheado(ahora) {
  if (cacheDolar.datos && cacheDolar.expiraEn > ahora) {
    return cacheDolar.datos;
  }
  try {
    const datos = await obtenerDolar();
    cacheDolar = { datos, expiraEn: ahora + CACHE_MS };
    return datos;
  } catch (err) {
    console.error('No se pudo obtener la cotización del dólar:', err.message);
    return null;
  }
}

async function obtenerClimaCacheado(localidadClave, ahora) {
  const cacheada = cacheClimaPorLocalidad.get(localidadClave);
  if (cacheada && cacheada.expiraEn > ahora) {
    return cacheada.datos;
  }
  try {
    const datos = await obtenerClima(localidadClave);
    cacheClimaPorLocalidad.set(localidadClave, { datos, expiraEn: ahora + CACHE_MS });
    return datos;
  } catch (err) {
    console.error(`No se pudo obtener el clima de ${localidadClave}:`, err.message);
    return null;
  }
}

/**
 * Devuelve `{ clima, dolar, actualizado, localidad }`. `clima`/`dolar`
 * son `null` si esa fuente en particular falló; nunca lanza una
 * excepción hacia arriba. El clima corresponde a la localidad pedida
 * (`la-plata` si no se pasa ninguna o no es una localidad conocida); el
 * dólar es el mismo para cualquier localidad. Cachea cada uno por
 * separado, 10 minutos.
 * @param {string} [localidadClave]
 */
async function obtenerClimaYDolar(localidadClave) {
  const localidad = normalizarLocalidad(localidadClave);
  const ahora = Date.now();

  const [clima, dolar] = await Promise.all([
    obtenerClimaCacheado(localidad, ahora),
    obtenerDolarCacheado(ahora),
  ]);

  return {
    clima,
    dolar,
    localidad,
    actualizado: new Date().toISOString(),
  };
}

module.exports = { obtenerClimaYDolar, LOCALIDADES, LOCALIDAD_POR_DEFECTO };
