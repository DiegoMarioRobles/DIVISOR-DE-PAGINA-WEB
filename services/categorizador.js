'use strict';

/**
 * Categorizador de noticias.
 *
 * Asigna una categoría fija a cada noticia contando coincidencias de
 * palabras clave dentro del texto combinado de título + resumen. La
 * comparación es insensible a mayúsculas/minúsculas y a acentos/tildes.
 *
 * Contrato (ver CONTRATO.md, sección 4bis):
 *   categorizar(titulo, resumen) -> nombre de categoría (string)
 *   CATEGORIAS -> array fijo con las 5 categorías, en orden.
 */

// Lista fija y ordenada de categorías posibles. 'General' es la categoría
// de reserva cuando el texto no matchea ninguna palabra clave: no se
// muestra como sección propia en el portal público (ver
// `routes/publico.js`, GET /api/categorias), pero sigue existiendo para
// que el categorizador siempre tenga dónde guardar lo que no matchea con
// ninguna de las otras cuatro.
//
// Taxonomía simplificada a pedido del administrador: las categorías
// anteriores más específicas de policiales ("Policía Bonaerense",
// "Accidentes", "Seguridad Vial", "Justicia") se fusionaron todas en una
// sola "Seguridad", y se agregaron "Política" e "Internacional" (el
// portal ahora también agrega medios locales generalistas, no solo de
// policiales).
const CATEGORIAS = ['Seguridad', 'Narcotráfico', 'Política', 'Internacional', 'General'];

// Palabras clave por categoría, normalizadas (minúsculas, sin acentos) al
// cargar el módulo, con la misma función que se usa para normalizar el
// texto de cada noticia, así la comparación es siempre consistente.
//
// ⚠️ 'bonaerense', 'agente' y 'gobierno' (sueltas) se evitan a propósito:
// son demasiado genéricas para un feed de noticias regionales de la
// provincia de Buenos Aires — aparecen en cualquier nota de economía o
// sociedad, no solo en la categoría que corresponde. Se prefieren frases
// compuestas o palabras más específicas.
//
// "Política" e "Internacional" son, por naturaleza, más difíciles de
// distinguir por palabras clave que "Seguridad" o "Narcotráfico" (son
// temas amplios). Para una fuente que es siempre de un tema fijo (ej. un
// medio 100% de política), es más confiable usar `categoria_default` en
// esa fuente (panel admin → Fuentes RSS) en vez de depender del
// categorizador automático acá.
const PALABRAS_CLAVE = {
  Seguridad: [
    'policía bonaerense',
    'policía',
    'policial',
    'comisaría',
    'efectivo policial',
    'patrullero',
    'uniformado',
    'destacamento',
    'detenido',
    'detención',
    'arresto',
    'aprehendido',
    'capturado',
    'prófugo',
    'allanamiento',
    'accidente',
    'choque',
    'colisión',
    'vuelco',
    'siniestro vial',
    'atropelló',
    'despiste',
    'alcoholemia',
    'control vehicular',
    'juicio',
    'condena',
    'fiscal',
    'fiscalía',
    'juzgado',
    'imputado',
    'sentencia',
    'procesado',
    'elevó a juicio',
  ],
  'Narcotráfico': [
    'droga',
    'narcotráfico',
    'narco',
    'cocaína',
    'marihuana',
    'paco',
    'búnker',
    'estupefacientes',
    'kiosco de drogas',
  ],
  'Política': [
    'gobernador',
    'intendente',
    'legislatura',
    'diputado',
    'senador',
    'concejal',
    'elecciones',
    'candidato',
    'ministro',
    'presidente',
    'gabinete',
    'proyecto de ley',
    'sesión legislativa',
    'oficialismo',
    'oposición política',
  ],
  Internacional: [
    'estados unidos',
    'unión europea',
    'medio oriente',
    'naciones unidas',
    'ucrania',
    'rusia',
    'internacional',
  ],
};

/**
 * Quita acentos/tildes y pasa a minúsculas para poder comparar texto de
 * forma insensible a mayúsculas y a acentuación (ej. "Policía" === "policia").
 * @param {string} texto
 * @returns {string}
 */
function normalizar(texto) {
  if (!texto) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // quita marcas diacríticas (tildes, diéresis)
}

// Las palabras clave se normalizan una única vez al cargar el módulo,
// para no repetir el trabajo en cada llamada a categorizar().
const PALABRAS_CLAVE_NORMALIZADAS = Object.fromEntries(
  Object.entries(PALABRAS_CLAVE).map(([categoria, palabras]) => [
    categoria,
    palabras.map(normalizar),
  ])
);

/**
 * Cuenta cuántas veces aparece `palabra` dentro de `texto` (ambos ya
 * normalizados previamente). Se cuenta por coincidencia de subcadena y no
 * de palabra completa a propósito: así "policial" también aporta puntaje
 * cuando el texto dice "policiales", sin necesitar una lista de plurales.
 * @param {string} texto - texto normalizado donde buscar.
 * @param {string} palabra - palabra clave normalizada a buscar.
 * @returns {number}
 */
function contarOcurrencias(texto, palabra) {
  if (!palabra) return 0;
  let cantidad = 0;
  let desde = 0;
  let posicion = texto.indexOf(palabra, desde);
  while (posicion !== -1) {
    cantidad += 1;
    desde = posicion + palabra.length;
    posicion = texto.indexOf(palabra, desde);
  }
  return cantidad;
}

/**
 * Determina la categoría de una noticia a partir de su título y resumen.
 * Cuenta coincidencias de palabras clave de cada categoría en el texto
 * combinado (título + resumen) y devuelve la categoría con más
 * coincidencias. Ante un empate gana la categoría que aparece primero en
 * `CATEGORIAS`. Si no hay ninguna coincidencia, devuelve 'General'.
 *
 * @param {string} titulo
 * @param {string} resumen
 * @returns {string} nombre de la categoría asignada
 */
function categorizar(titulo, resumen) {
  const textoNormalizado = normalizar(`${titulo || ''} ${resumen || ''}`);

  let mejorCategoria = 'General';
  let mejorPuntaje = 0;

  for (const categoria of CATEGORIAS) {
    if (categoria === 'General') continue; // 'General' no tiene palabras clave propias

    const palabras = PALABRAS_CLAVE_NORMALIZADAS[categoria] || [];
    let puntaje = 0;
    for (const palabra of palabras) {
      puntaje += contarOcurrencias(textoNormalizado, palabra);
    }

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorCategoria = categoria;
    }
  }

  return mejorCategoria;
}

module.exports = {
  categorizar,
  CATEGORIAS,
};
