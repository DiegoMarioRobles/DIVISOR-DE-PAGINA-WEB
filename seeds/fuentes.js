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

  // ---------------------------------------------------------------------
  // Las siguientes 20 fuentes las pasó el administrador directamente (no
  // son una investigación propia de este código). Se marcan `activa:
  // true` porque el propio administrador las aportó, pero TAMPOCO se
  // pudieron probar en vivo en este entorno de desarrollo (mismo bloqueo
  // de red de siempre). El motor RSS aísla fallas por fuente: si alguna
  // de estas URLs no responde o cambió, va a quedar reflejado solo en su
  // columna `ultimo_error` de la tabla Fuentes RSS del panel, sin afectar
  // a las demás. Conviene revisar esa tabla después del primer despliegue
  // y corregir o desactivar la que haya fallado.
  // ---------------------------------------------------------------------
  {
    nombre: 'Diario La Ciudad',
    url_rss: 'https://laciudadavellaneda.com.ar/feed/',
    sitio_web: 'https://laciudadavellaneda.com.ar',
    activa: true,
  },
  {
    nombre: 'InfoAvellaneda',
    url_rss: 'https://infoavellaneda.com.ar/feed/',
    sitio_web: 'https://infoavellaneda.com.ar',
    activa: true,
  },
  {
    nombre: 'Diario de Morón',
    url_rss: 'https://diariodemoron.com.ar/feed/',
    sitio_web: 'https://diariodemoron.com.ar',
    activa: true,
  },
  {
    nombre: 'El 1 Digital',
    url_rss: 'https://el1digital.com.ar/feed/',
    sitio_web: 'https://el1digital.com.ar',
    activa: true,
  },
  {
    nombre: 'El Mensajero de Moreno',
    url_rss: 'https://elmensajerodemoreno.com.ar/feed/',
    sitio_web: 'https://elmensajerodemoreno.com.ar',
    activa: true,
  },
  {
    nombre: 'Zona Norte Visión',
    url_rss: 'https://zonanortevision.com.ar/feed/',
    sitio_web: 'https://zonanortevision.com.ar',
    activa: true,
  },
  {
    nombre: 'El Suburbano Digital',
    url_rss: 'https://elsuburbanodigital.com.ar/feed/',
    sitio_web: 'https://elsuburbanodigital.com.ar',
    activa: true,
  },
  {
    nombre: 'Centro Informativo Quilmes',
    url_rss: 'https://centroinformativoq.com.ar/feed/',
    sitio_web: 'https://centroinformativoq.com.ar',
    activa: true,
  },
  {
    nombre: 'El Sol de Quilmes',
    url_rss: 'https://elsolquilmes.com.ar/feed/',
    sitio_web: 'https://elsolquilmes.com.ar',
    activa: true,
  },
  {
    nombre: 'Quilmes Presente',
    url_rss: 'https://quilmespresente.com.ar/feed/',
    sitio_web: 'https://quilmespresente.com.ar',
    activa: true,
  },
  {
    nombre: 'El Diario Varelense',
    url_rss: 'https://eldiariovarelense.com.ar/feed/',
    sitio_web: 'https://eldiariovarelense.com.ar',
    activa: true,
  },
  {
    nombre: 'Varela al Día',
    url_rss: 'https://varelaaldia.com.ar/feed/',
    sitio_web: 'https://varelaaldia.com.ar',
    activa: true,
  },
  {
    nombre: 'Infosur Diario',
    url_rss: 'https://infosurdiario.com.ar/feed/',
    sitio_web: 'https://infosurdiario.com.ar',
    activa: true,
  },
  {
    nombre: 'Diario La Verdad',
    url_rss: 'https://www.diariolaverdad.com.ar/feed/',
    sitio_web: 'https://www.diariolaverdad.com.ar',
    activa: true,
  },
  {
    nombre: 'La Unión (Zona Sur)',
    url_rss: 'https://www.launion.com.ar/feed/',
    sitio_web: 'https://www.launion.com.ar',
    activa: true,
  },
  {
    nombre: 'Radar Norte',
    url_rss: 'https://radarnorte.ar/feed/',
    sitio_web: 'https://radarnorte.ar',
    activa: true,
  },
  {
    nombre: 'ParaBuenosAires',
    url_rss: 'https://parabuenosaires.com/feed/',
    sitio_web: 'https://parabuenosaires.com',
    activa: true,
  },
  {
    nombre: 'Diario El Día (eldia.com.ar)',
    url_rss: 'https://www.eldia.com.ar/feed/',
    sitio_web: 'https://www.eldia.com.ar',
    activa: true,
  },
  {
    nombre: '0221 La Plata',
    url_rss: 'https://www.0221.com.ar/feed/',
    sitio_web: 'https://www.0221.com.ar',
    activa: true,
  },
  {
    nombre: 'Diario Panorama',
    url_rss: 'https://www.dib.com.ar/feed/',
    sitio_web: 'https://www.dib.com.ar',
    activa: true,
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
