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
  // Las siguientes fuentes las pasó el administrador directamente (no son
  // una investigación propia de este código). Se marcan `activa: true`
  // porque el propio administrador las aportó, pero TAMPOCO se pudieron
  // probar en vivo en este entorno de desarrollo (mismo bloqueo de red de
  // siempre). El motor RSS aísla fallas por fuente: si alguna de estas
  // URLs no responde o cambió, va a quedar reflejado solo en su columna
  // `ultimo_error` de la tabla Fuentes RSS del panel, sin afectar a las
  // demás. Conviene revisar esa tabla después del primer despliegue y
  // corregir o desactivar la que haya fallado.
  //
  // De esta primera tanda de 20, el propio administrador ya identificó 11
  // como muertas (dominio inexistente, 404, o error de parseo) tras
  // probarlas desde su hosting real; se sacaron de esta lista y se
  // desactivan en `database/migraciones.js` (`desactivarFuentesMuertas`)
  // para cualquier base que ya las tuviera cargadas. Quedan las 9 que
  // siguen andando.
  // ---------------------------------------------------------------------
  {
    nombre: 'Diario La Ciudad (Avellaneda)',
    url_rss: 'https://laciudadavellaneda.com.ar/feed/',
    sitio_web: 'https://laciudadavellaneda.com.ar',
    activa: true,
  },
  {
    nombre: 'El 1 Digital',
    url_rss: 'https://el1digital.com.ar/feed/',
    sitio_web: 'https://el1digital.com.ar',
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

  // ---------------------------------------------------------------------
  // Tanda nueva: 31 fuentes que el administrador confirmó funcionando en
  // vivo (probadas desde su propio hosting, no desde este sandbox), más
  // 10 "probables" que también aportó — sitios WordPress/Blogger reales
  // que no se pudieron confirmar por timeout de red desde su servidor de
  // verificación, pero con alta probabilidad de funcionar igual. Quedan
  // marcadas `activa: true` las 31 confirmadas y también las 10
  // probables (mismo criterio que rondas anteriores: revisar la columna
  // `ultimo_error` del panel después del despliegue y desactivar la que
  // falle).
  // ---------------------------------------------------------------------

  // Zona Sur — Quilmes, Lomas, Alte. Brown, Berisso, Brandsen
  {
    nombre: 'Hecho en Quilmes',
    url_rss: 'https://hechoenquilmes.com/feed/',
    sitio_web: 'https://hechoenquilmes.com',
    activa: true,
  },
  {
    nombre: 'Radio Murmullo',
    url_rss: 'https://radiomurmullo.blogspot.com/feeds/posts/default',
    sitio_web: 'https://radiomurmullo.blogspot.com',
    activa: true,
  },
  {
    nombre: 'Diario Lomas',
    url_rss: 'https://diariolomas.com.ar/feed/',
    sitio_web: 'https://diariolomas.com.ar',
    activa: true,
  },
  {
    nombre: 'Lomas de Zamora Hoy',
    url_rss: 'https://lomasdezamorahoy.com/feed/',
    sitio_web: 'https://lomasdezamorahoy.com',
    activa: true,
  },
  {
    nombre: 'De Brown',
    url_rss: 'https://www.debrown.com.ar/feed/',
    sitio_web: 'https://www.debrown.com.ar',
    activa: true,
  },
  {
    nombre: 'Berisso Digital',
    url_rss: 'https://berissodigital.com/wp/feed/',
    sitio_web: 'https://berissodigital.com',
    activa: true,
  },
  {
    nombre: 'El Mundo de Berisso',
    url_rss: 'https://elmundodeberisso.com.ar/feed/',
    sitio_web: 'https://elmundodeberisso.com.ar',
    activa: true,
  },
  {
    nombre: 'La Gran Capital',
    url_rss: 'https://lagrancapital.com/feed/',
    sitio_web: 'https://lagrancapital.com',
    activa: true,
  },
  {
    nombre: 'Noticias Brandsen',
    url_rss: 'https://noticiasbrandsen.com/feed/',
    sitio_web: 'https://noticiasbrandsen.com',
    activa: true,
  },
  {
    nombre: 'Noticias Cañuelas',
    url_rss: 'https://noticiascanuelas.com/feed/',
    sitio_web: 'https://noticiascanuelas.com',
    activa: true,
  },

  // Zona Oeste — Ituzaingó, Morón, Hurlingham
  {
    nombre: 'Diario La Ciudad (Ituzaingó)',
    url_rss: 'https://laciudadweb.com.ar/feed/',
    sitio_web: 'https://laciudadweb.com.ar',
    activa: true,
  },
  {
    nombre: 'Diario Anticipos',
    url_rss: 'https://diarioanticipos.com/feed/',
    sitio_web: 'https://diarioanticipos.com',
    activa: true,
  },
  {
    nombre: 'Primer Plano Online',
    url_rss: 'https://primerplanoonline.com.ar/feed/',
    sitio_web: 'https://primerplanoonline.com.ar',
    activa: true,
  },
  {
    nombre: 'Zona Oeste Diario',
    url_rss: 'https://zonaoestediario.com.ar/feeds/posts/default',
    sitio_web: 'https://zonaoestediario.com.ar',
    activa: true,
  },
  {
    nombre: 'Crónicas del Oeste',
    url_rss: 'https://cronicasdeloeste.net/?feed=rss2',
    sitio_web: 'https://cronicasdeloeste.net',
    activa: true,
  },

  // Zona Norte — San Martín, Tigre, San Isidro, San Miguel
  {
    nombre: 'Informe Norte',
    url_rss: 'https://informenorte.com.ar/feed/',
    sitio_web: 'https://informenorte.com.ar',
    activa: true,
  },
  {
    nombre: 'Zona Norte Diario Online',
    url_rss: 'https://www.zonanortediario.com.ar/feed/',
    sitio_web: 'https://www.zonanortediario.com.ar',
    activa: true,
  },
  {
    nombre: 'Diario Efecto',
    url_rss: 'https://diarioefecto.com.ar/feed/',
    sitio_web: 'https://diarioefecto.com.ar',
    activa: true,
  },
  {
    nombre: 'Norte Online',
    url_rss: 'https://www.norteonline.com.ar/feed/',
    sitio_web: 'https://www.norteonline.com.ar',
    activa: true,
  },

  // La Matanza
  {
    nombre: 'Matanza Global',
    url_rss: 'https://www.matanzaglobal.com/rss.xml',
    sitio_web: 'https://www.matanzaglobal.com',
    activa: true,
  },
  {
    nombre: 'El Nacional de Matanza',
    url_rss: 'https://elnacionaldematanza.com.ar/feed/',
    sitio_web: 'https://elnacionaldematanza.com.ar',
    activa: true,
  },

  // Generales del Conurbano / Provincia
  {
    nombre: 'Data Conurbano',
    url_rss: 'https://dataconurbano.net/feed/',
    sitio_web: 'https://dataconurbano.net',
    activa: true,
  },
  {
    nombre: 'La Política Online — Conurbano',
    url_rss: 'http://www.lapoliticaonline.com.ar/files/rss/conurbano.xml',
    sitio_web: 'https://www.lapoliticaonline.com.ar',
    activa: true,
  },
  {
    nombre: 'Medios Digitales Diario Digital',
    url_rss: 'https://www.mediosdigitales.com.ar/feed.xml',
    sitio_web: 'https://www.mediosdigitales.com.ar',
    activa: true,
  },
  {
    nombre: 'Data Diario',
    url_rss: 'https://www.datadiario.com/feed/',
    sitio_web: 'https://www.datadiario.com',
    activa: true,
  },
  {
    nombre: 'Index.net.ar',
    url_rss: 'https://index.net.ar/feed/',
    sitio_web: 'https://index.net.ar',
    activa: true,
  },
  {
    nombre: 'Parlamentario',
    url_rss: 'https://www.parlamentario.com/feed/',
    sitio_web: 'https://www.parlamentario.com',
    activa: true,
  },
  {
    nombre: 'Diario Noticias Web',
    url_rss: 'https://diarionoticiasweb.com.ar/feed/',
    sitio_web: 'https://diarionoticiasweb.com.ar',
    activa: true,
  },

  // Nacionales con fuerte cobertura del Conurbano
  {
    nombre: 'Crónica',
    url_rss: 'https://www.cronica.com.ar/feed/',
    sitio_web: 'https://www.cronica.com.ar',
    activa: true,
  },
  {
    nombre: 'Perfil',
    url_rss: 'https://www.perfil.com/feed',
    sitio_web: 'https://www.perfil.com',
    activa: true,
  },
  {
    nombre: 'Tiempo Argentino',
    url_rss: 'https://www.tiempoar.com.ar/feed/',
    sitio_web: 'https://www.tiempoar.com.ar',
    activa: true,
  },

  // "Probables" (10): sitios WordPress reales que dieron timeout desde el
  // servidor de verificación del administrador, no confirmados en vivo
  // pero con alta probabilidad de funcionar.
  {
    nombre: 'Amba Noticias',
    url_rss: 'https://www.ambanoticias.com/feed/',
    sitio_web: 'https://www.ambanoticias.com',
    activa: true,
  },
  {
    nombre: 'Merlo GBA',
    url_rss: 'https://www.merlogba.com/feed/',
    sitio_web: 'https://www.merlogba.com',
    activa: true,
  },
  {
    nombre: 'El Sol Noticias',
    url_rss: 'https://elsolnoticias.com.ar/feed/',
    sitio_web: 'https://elsolnoticias.com.ar',
    activa: true,
  },
  {
    nombre: 'De Norte a Norte',
    url_rss: 'https://denorteanorte.com/feed/',
    sitio_web: 'https://denorteanorte.com',
    activa: true,
  },
  {
    nombre: 'Cañuelas Digital',
    url_rss: 'https://canuelasdigital.com/feed/',
    sitio_web: 'https://canuelasdigital.com',
    activa: true,
  },
  {
    nombre: 'Hurlingham al Día',
    url_rss: 'https://www.hurlinghamaldia.com/feed/',
    sitio_web: 'https://www.hurlinghamaldia.com',
    activa: true,
  },
  {
    nombre: 'Diario La Pluma',
    url_rss: 'https://diariolapluma.com.ar/feed/',
    sitio_web: 'https://diariolapluma.com.ar',
    activa: true,
  },
  {
    nombre: 'Costa Norte',
    url_rss: 'https://www.costanorte.com.ar/feed/',
    sitio_web: 'https://www.costanorte.com.ar',
    activa: true,
  },
  {
    nombre: 'Zona Norte Online',
    url_rss: 'https://www.zonanorteonline.com.ar/feed/',
    sitio_web: 'https://www.zonanorteonline.com.ar',
    activa: true,
  },
  {
    nombre: 'InfoCielo',
    url_rss: 'https://www.infocielo.com/feed/',
    sitio_web: 'https://www.infocielo.com',
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
