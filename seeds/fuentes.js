'use strict';

/**
 * Seed de fuentes RSS.
 *
 * Este archivo exporta un array de objetos `{ nombre, url_rss, sitio_web }`
 * pensado para usarse desde el seed de la base de datos (inserta filas en
 * la tabla `fuentes`, ver CONTRATO.md sección 1) y como referencia para
 * que el usuario final agregue sus propias fuentes fácilmente después
 * (a mano acá, o desde el panel admin con `POST /api/admin/fuentes`).
 *
 * ⚠️ IMPORTANTE — sobre el estado "no verificado" de estas fuentes:
 *
 * El entorno de desarrollo donde se escribió este archivo tiene la salida
 * de red bloqueada hacia dominios de medios argentinos (se probó contra
 * varios candidatos —incluidos infobae.com, diariopopular.com.ar,
 * eldia.com y minutouno.com— tanto con `curl` como con la herramienta de
 * fetch web, y todos devolvieron 403 / EGRESS_BLOCKED por política del
 * proxy de red del sandbox, no por un problema de los feeds en sí). Por
 * lo tanto NINGUNA de las URLs de abajo pudo probarse en vivo durante
 * esta sesión: son candidatos conocidos por cobertura policial y de la
 * provincia de Buenos Aires, pero ninguno debe asumirse funcional.
 *
 * Antes de poner `activa: true` en cualquiera de estas fuentes (o de
 * confiar en que `url_rss` es exactamente correcta), hay que validarla
 * con el botón "Validar fuente" del panel admin (que llama a
 * `POST /api/admin/fuentes/validar`, resuelto por
 * `services/rssService.js#validarFeed`) una vez que el proyecto esté
 * desplegado en un entorno con salida a internet normal (por ejemplo,
 * Railway en producción). Si la ruta de un feed cambió, probar variantes
 * habituales como `/feed`, `/rss`, `/rss.xml` o `/rss/ultimas-noticias.xml`
 * antes de descartar la fuente.
 *
 * Todas quedan con `activa: false` a propósito: el seed de la base debe
 * insertarlas inactivas, y es el administrador quien las activa una vez
 * confirmadas.
 */

const FUENTES = [
  // NO VERIFICADO EN ESTE ENTORNO (sin salida a internet) — validar con el
  // botón "Validar fuente" del panel admin antes de activar.
  // Medio nacional, pero con la cobertura de policiales/inseguridad más
  // extensa de los medios argentinos y buena presencia de casos de la
  // provincia de Buenos Aires. Usa Arc Publishing (mismo motor que La
  // Nación), cuyo patrón estándar de feed saliente es
  // "/arc/outboundfeeds/rss/".
  {
    nombre: 'Infobae',
    url_rss: 'https://www.infobae.com/arc/outboundfeeds/rss/',
    sitio_web: 'https://www.infobae.com',
    activa: false,
  },

  // NO VERIFICADO EN ESTE ENTORNO (sin salida a internet) — validar con el
  // botón "Validar fuente" del panel admin antes de activar.
  // Medio nacional (Arc Publishing), sección de seguridad/policiales con
  // cobertura habitual de la provincia de Buenos Aires.
  {
    nombre: 'La Nación',
    url_rss: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/',
    sitio_web: 'https://www.lanacion.com.ar',
    activa: false,
  },

  // NO VERIFICADO EN ESTE ENTORNO (sin salida a internet) — validar con el
  // botón "Validar fuente" del panel admin antes de activar.
  // Medio nacional con sección "Policiales" dedicada; la ruta exacta del
  // feed es una estimación basada en el patrón histórico del sitio
  // (`/rss/<sección>/`) y puede haber cambiado.
  {
    nombre: 'Clarín - Policiales',
    url_rss: 'https://www.clarin.com/rss/policiales/',
    sitio_web: 'https://www.clarin.com/policiales',
    activa: false,
  },

  // NO VERIFICADO EN ESTE ENTORNO (sin salida a internet) — validar con el
  // botón "Validar fuente" del panel admin antes de activar.
  // Diario de tirada en el Gran Buenos Aires con fuerte identidad
  // provincial y cobertura policial extensa de la Provincia de Buenos
  // Aires: es el candidato local/provincial de mayor prioridad de esta
  // lista. La ruta exacta del feed es una estimación, no está confirmada.
  {
    nombre: 'Diario Popular',
    url_rss: 'https://www.diariopopular.com.ar/rss.xml',
    sitio_web: 'https://www.diariopopular.com.ar',
    activa: false,
  },

  // NO VERIFICADO EN ESTE ENTORNO (sin salida a internet) — validar con el
  // botón "Validar fuente" del panel admin antes de activar.
  // Diario de La Plata, capital de la Provincia de Buenos Aires: medio
  // local/provincial con sección de policiales propia. La ruta exacta
  // del feed es una estimación, no está confirmada.
  {
    nombre: 'El Día (La Plata)',
    url_rss: 'https://www.eldia.com/rss',
    sitio_web: 'https://www.eldia.com',
    activa: false,
  },
];

/**
 * Ejemplo de cómo agregar una fuente propia a este archivo (no se inserta
 * automáticamente: es solo referencia para copiar y completar). También
 * se puede cargar una fuente nueva sin tocar este archivo, directamente
 * desde el panel admin con `POST /api/admin/fuentes`.
 *
 * {
 *   nombre: 'Nombre del medio',
 *   url_rss: 'https://ejemplo.com/rss.xml', // validar antes de activar
 *   sitio_web: 'https://ejemplo.com',
 *   activa: false, // activar solo después de validar el feed
 * }
 */

module.exports = FUENTES;
